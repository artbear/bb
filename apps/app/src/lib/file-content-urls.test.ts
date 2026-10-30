import { describe, expect, it } from "vitest";
import { buildThreadHostFileContentUrl } from "./file-content-urls";

describe("buildThreadHostFileContentUrl", () => {
  it("keeps a UNC root instead of turning it into a POSIX path", () => {
    expect(
      buildThreadHostFileContentUrl("thr_1", "\\\\server\\share\\file.zip"),
    ).toBe("/api/v1/threads/thr_1/host-files/unc%3Aserver/share/file.zip");
  });

  it("keeps a Windows drive path and a POSIX path", () => {
    expect(
      buildThreadHostFileContentUrl("thr_1", "C:\\Users\\me\\file.zip"),
    ).toBe("/api/v1/threads/thr_1/host-files/C%3A/Users/me/file.zip");
    expect(buildThreadHostFileContentUrl("thr_1", "/tmp/file.zip")).toBe(
      "/api/v1/threads/thr_1/host-files/tmp/file.zip",
    );
  });
});
