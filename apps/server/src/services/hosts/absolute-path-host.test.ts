import { describe, expect, it, vi } from "vitest";
import type { ApiError } from "../../errors.js";
import {
  resolveHostIdForAbsolutePath,
  type AbsolutePathHostCandidate,
} from "./absolute-path-host.js";

const LINUX_PATH = "/home/node/bb/README.md";
const WINDOWS_PATH =
  "C:\\Users\\Aptyp\\Downloads\\bb-server-recovery-20261029.zip";
const UNC_PATH = "\\\\server\\share\\file.zip";

const linux: AbsolutePathHostCandidate = {
  hostId: "host-linux",
  platform: "linux",
};
const windowsNotebook: AbsolutePathHostCandidate = {
  hostId: "host-notebook",
  platform: "win32",
};
const windowsRdp: AbsolutePathHostCandidate = {
  hostId: "host-rdp",
  platform: "win32",
};
const mac: AbsolutePathHostCandidate = {
  hostId: "host-mac",
  platform: "darwin",
};

describe("resolveHostIdForAbsolutePath", () => {
  it("keeps a POSIX path on the Linux environment host", async () => {
    const probePath = vi.fn();
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, windowsNotebook],
        path: LINUX_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "linux",
        probePath,
      }),
    ).resolves.toBe(linux.hostId);
    expect(probePath).not.toHaveBeenCalled();
  });

  it("keeps a Windows path on the Windows environment host", async () => {
    const probePath = vi.fn();
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, windowsNotebook],
        path: WINDOWS_PATH,
        preferredHostId: windowsNotebook.hostId,
        preferredPlatform: "win32",
        probePath,
      }),
    ).resolves.toBe(windowsNotebook.hostId);
    expect(probePath).not.toHaveBeenCalled();
  });

  it("opens a Windows path from a Linux thread on the connected Windows machine", async () => {
    const probePath = vi.fn();
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, windowsNotebook],
        path: WINDOWS_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "linux",
        probePath,
      }),
    ).resolves.toBe(windowsNotebook.hostId);
    expect(probePath).not.toHaveBeenCalled();
  });

  it("opens a POSIX path from a Windows thread on the connected Linux machine", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [windowsNotebook, linux],
        path: LINUX_PATH,
        preferredHostId: windowsNotebook.hostId,
        preferredPlatform: "win32",
        probePath: vi.fn(),
      }),
    ).resolves.toBe(linux.hostId);
  });

  it("chooses the Windows machine that has the file when several are connected", async () => {
    const probePath = vi.fn(
      async (hostId: string) => hostId === "host-notebook",
    );
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, windowsRdp, windowsNotebook],
        path: WINDOWS_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "linux",
        probePath,
      }),
    ).resolves.toBe(windowsNotebook.hostId);
    expect(probePath).toHaveBeenCalledWith(windowsRdp.hostId);
    expect(probePath).toHaveBeenCalledWith(windowsNotebook.hostId);
  });

  it("rejects a Windows path when no Windows machine is connected", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, mac],
        path: WINDOWS_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "linux",
        probePath: vi.fn(),
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "host_unavailable",
        message:
          "This Windows path cannot be opened because no Windows machine is connected.",
      },
    } satisfies Partial<ApiError>);
  });

  it("reports when no connected Windows machine has the file", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, windowsRdp, windowsNotebook],
        path: WINDOWS_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "linux",
        probePath: vi.fn(async () => false),
      }),
    ).rejects.toMatchObject({
      status: 404,
      body: { code: "not_found" },
    });
  });

  it("reads from a machine whose existence check failed when another machine does not have the file", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, windowsRdp, windowsNotebook],
        path: WINDOWS_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "linux",
        probePath: vi.fn(async (hostId: string) =>
          hostId === windowsNotebook.hostId ? null : false,
        ),
      }),
    ).resolves.toBe(windowsNotebook.hostId);
  });

  it("opens a UNC path on the connected Windows machine", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux, windowsNotebook],
        path: UNC_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "linux",
        probePath: vi.fn(),
      }),
    ).resolves.toBe(windowsNotebook.hostId);
  });

  it("does not send a Windows path to a host with an unknown platform", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [{ hostId: "host-linux", platform: "unknown" }],
        path: WINDOWS_PATH,
        preferredHostId: "host-linux",
        preferredPlatform: "unknown",
        probePath: vi.fn(),
      }),
    ).rejects.toMatchObject({
      body: { code: "host_unavailable" },
    });
  });

  it("opens a POSIX path on a connected Linux machine when the preferred host has no confirmed platform", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [linux],
        path: LINUX_PATH,
        preferredHostId: windowsNotebook.hostId,
        preferredPlatform: null,
        probePath: vi.fn(),
      }),
    ).resolves.toBe(linux.hostId);
  });

  it("does not treat an unknown platform as able to open a POSIX path", async () => {
    await expect(
      resolveHostIdForAbsolutePath({
        candidates: [{ hostId: linux.hostId, platform: "unknown" }],
        path: LINUX_PATH,
        preferredHostId: linux.hostId,
        preferredPlatform: "unknown",
        probePath: vi.fn(),
      }),
    ).rejects.toMatchObject({
      body: { code: "host_unavailable" },
    });
  });
});
