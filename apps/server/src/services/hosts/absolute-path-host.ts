import { isAbsoluteHostPath, isWindowsHostPath } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "./online-rpc.js";

const PATH_EXISTS_PROBE_TIMEOUT_MS = 5_000;

export interface AbsolutePathHostCandidate {
  hostId: string;
  platform: HostPlatform | null;
}

type HostPathFlavor = "posix" | "windows";

const CONFIRMED_POSIX_PLATFORMS = new Set<HostPlatform>([
  "linux",
  "darwin",
  "wsl",
]);

export type AbsolutePathProbe = (hostId: string) => Promise<boolean | null>;

interface ResolveHostIdForAbsolutePathArgs {
  candidates: readonly AbsolutePathHostCandidate[];
  path: string;
  preferredHostId: string;
  preferredPlatform: HostPlatform | null;
  probePath: AbsolutePathProbe;
}

function pathFlavor(path: string): HostPathFlavor | null {
  if (!isAbsoluteHostPath(path)) return null;
  return isWindowsHostPath(path) ? "windows" : "posix";
}

function platformOpensFlavor(
  platform: HostPlatform | null,
  flavor: HostPathFlavor,
): boolean {
  if (platform === null || platform === "unknown") return false;
  if (flavor === "windows") return platform === "win32";
  return CONFIRMED_POSIX_PLATFORMS.has(platform);
}

function unavailableMessage(flavor: HostPathFlavor): string {
  return flavor === "windows"
    ? "This Windows path cannot be opened because no Windows machine is connected."
    : "This POSIX path cannot be opened because no Linux or macOS machine is connected.";
}

function notFoundMessage(flavor: HostPathFlavor): string {
  return flavor === "windows"
    ? "File was not found on the connected Windows machines."
    : "File was not found on the connected Linux or macOS machines.";
}

function matchingHostIds(
  args: ResolveHostIdForAbsolutePathArgs,
  flavor: HostPathFlavor,
): string[] {
  const hostIds: string[] = [];
  for (const candidate of args.candidates) {
    if (candidate.hostId === args.preferredHostId) continue;
    if (!platformOpensFlavor(candidate.platform, flavor)) continue;
    hostIds.push(candidate.hostId);
  }
  return hostIds;
}

export async function resolveHostIdForAbsolutePath(
  args: ResolveHostIdForAbsolutePathArgs,
): Promise<string> {
  const flavor = pathFlavor(args.path);
  if (flavor === null || platformOpensFlavor(args.preferredPlatform, flavor)) {
    return args.preferredHostId;
  }

  const hostIds = matchingHostIds(args, flavor);
  if (hostIds.length === 0) {
    throw new ApiError(
      409,
      "host_unavailable",
      unavailableMessage(flavor),
      false,
    );
  }
  if (hostIds.length === 1) {
    const onlyHostId = hostIds[0];
    if (onlyHostId === undefined) {
      throw new ApiError(
        409,
        "host_unavailable",
        unavailableMessage(flavor),
        false,
      );
    }
    return onlyHostId;
  }

  const foundHostIds: string[] = [];
  const failedHostIds: string[] = [];
  for (const hostId of hostIds) {
    const exists = await args.probePath(hostId);
    if (exists === true) foundHostIds.push(hostId);
    else if (exists === null) failedHostIds.push(hostId);
  }

  const foundHostId = foundHostIds[0];
  if (foundHostId !== undefined) return foundHostId;
  const failedHostId = failedHostIds[0];
  if (failedHostId !== undefined) return failedHostId;
  throw new ApiError(404, "not_found", notFoundMessage(flavor), false);
}

export function probeAbsolutePathOnHost(
  deps: WorkSessionDeps,
  hostId: string,
  path: string,
): Promise<boolean | null> {
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: PATH_EXISTS_PROBE_TIMEOUT_MS,
    command: { type: "host.paths_exist", paths: [path] },
  }).then(
    (result) => result.existence[path] === true,
    () => null,
  );
}
