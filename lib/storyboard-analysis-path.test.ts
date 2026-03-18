import { beforeEach, describe, expect, it, vi } from "vitest";

const storyboardPathMocks = vi.hoisted(() => ({
  isCloudStoragePath: vi.fn(),
  materializeStoredFile: vi.fn(),
  resolveStoredFileBinaryInput: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  isCloudStoragePath: storyboardPathMocks.isCloudStoragePath,
  materializeStoredFile: storyboardPathMocks.materializeStoredFile,
  resolveStoredFileBinaryInput: storyboardPathMocks.resolveStoredFileBinaryInput,
}));

import { storyboardTestUtils } from "@/lib/storyboard";

describe("resolveAssetPathForStoryboardAnalysis", () => {
  beforeEach(() => {
    storyboardPathMocks.isCloudStoragePath.mockReset();
    storyboardPathMocks.materializeStoredFile.mockReset();
    storyboardPathMocks.resolveStoredFileBinaryInput.mockReset();
  });

  it("uses an authenticated storage input for cloud video assets", async () => {
    storyboardPathMocks.isCloudStoragePath.mockReturnValue(true);
    storyboardPathMocks.resolveStoredFileBinaryInput.mockResolvedValue({
      inputArgs: ["-headers", "Authorization: Bearer token\r\n"],
      inputPath: "https://storage.googleapis.com/download/storage/v1/b/bucket/o/video.mov?alt=media",
    });

    const resolvedPath = await storyboardTestUtils.resolveAssetPathForStoryboardAnalysis({
      asset: {
        id: "asset-1",
        path: "gs://media-bucket/media/user-1/asset-1/video.mov",
        type: "video",
      },
      tempDir: "/tmp/storyboard",
    });

    expect(resolvedPath).toEqual({
      inputArgs: ["-headers", "Authorization: Bearer token\r\n"],
      inputPath: "https://storage.googleapis.com/download/storage/v1/b/bucket/o/video.mov?alt=media",
    });
    expect(storyboardPathMocks.resolveStoredFileBinaryInput).toHaveBeenCalledWith("gs://media-bucket/media/user-1/asset-1/video.mov");
    expect(storyboardPathMocks.materializeStoredFile).not.toHaveBeenCalled();
  });

  it("still materializes non-video assets locally", async () => {
    storyboardPathMocks.isCloudStoragePath.mockReturnValue(true);
    storyboardPathMocks.materializeStoredFile.mockResolvedValue("/tmp/storyboard/image.png");

    const resolvedPath = await storyboardTestUtils.resolveAssetPathForStoryboardAnalysis({
      asset: {
        id: "asset-2",
        path: "gs://media-bucket/media/user-1/asset-2/image.png",
        type: "image",
      },
      tempDir: "/tmp/storyboard",
    });

    expect(resolvedPath).toEqual({
      inputPath: "/tmp/storyboard/image.png",
    });
    expect(storyboardPathMocks.materializeStoredFile).toHaveBeenCalledWith({
      filePath: "gs://media-bucket/media/user-1/asset-2/image.png",
      tempDir: "/tmp/storyboard",
    });
    expect(storyboardPathMocks.resolveStoredFileBinaryInput).not.toHaveBeenCalled();
  });
});
