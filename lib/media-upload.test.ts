import { describe, expect, it } from "vitest";

import {
  CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES,
  formatLegacyUploadTooLargeMessage,
  isCloudRunHostname,
  validateClientMediaUpload,
} from "@/lib/media-upload";

describe("isCloudRunHostname", () => {
  it("detects run.app hosts", () => {
    expect(isCloudRunHostname("creator-pilot-abc-uc.a.run.app")).toBe(true);
    expect(isCloudRunHostname("localhost")).toBe(false);
  });
});

describe("validateClientMediaUpload", () => {
  it("does not enforce the Cloud Run size limit for local hosts", () => {
    expect(
      validateClientMediaUpload({
        hostname: "localhost",
        files: [{ name: "clip.mp4", size: CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES + 1 }],
      }),
    ).toBeNull();
  });

  it("returns a clear validation error for oversized Cloud Run uploads", () => {
    expect(
      validateClientMediaUpload({
        hostname: "creator-pilot-abc-uc.a.run.app",
        files: [{ name: "clip.mp4", size: CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES + 1024 }],
      }),
    ).toContain("clip.mp4");
  });

  it("does not block uploads when direct mode is enabled", () => {
    expect(
      validateClientMediaUpload({
        hostname: "creator-pilot-abc-uc.a.run.app",
        uploadMode: "direct",
        files: [{ name: "clip.mp4", size: CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES + 1024 }],
      }),
    ).toBeNull();
  });
});

describe("formatLegacyUploadTooLargeMessage", () => {
  it("mentions the safe upload size", () => {
    expect(formatLegacyUploadTooLargeMessage()).toContain("30 MB");
  });
});
