import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaStorageMocks = vi.hoisted(() => ({
  getFiles: vi.fn(),
  getMetadata: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mediaAsset: {
      upsert: mediaStorageMocks.upsert,
    },
  },
}));

vi.mock("@/lib/storage", () => ({
  getStorageClient: () => ({
    bucket: () => ({
      getFiles: mediaStorageMocks.getFiles,
    }),
  }),
}));

import { reconcileMediaAssetsFromStorage } from "@/lib/media-storage";

describe("reconcileMediaAssetsFromStorage", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mediaStorageMocks.getFiles.mockReset();
    mediaStorageMocks.getMetadata.mockReset();
    mediaStorageMocks.upsert.mockReset();
  });

  it("restores uploaded assets from Cloud Storage metadata", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");

    mediaStorageMocks.getMetadata.mockResolvedValue([
      {
        contentType: "video/quicktime",
        size: "3495003117",
        timeCreated: "2026-03-17T19:20:00.000Z",
        updated: "2026-03-17T19:21:00.000Z",
      },
    ]);
    mediaStorageMocks.getFiles.mockResolvedValue([
      [
        {
          getMetadata: mediaStorageMocks.getMetadata,
          name: "media/user-1/media_asset-1/CP-Demo_Video.mov",
        },
      ],
    ]);
    mediaStorageMocks.upsert.mockResolvedValue({});

    const restoredCount = await reconcileMediaAssetsFromStorage("user-1");

    expect(restoredCount).toBe(1);
    expect(mediaStorageMocks.upsert).toHaveBeenCalledWith({
      where: {
        id: "media_asset-1",
      },
      create: expect.objectContaining({
        id: "media_asset-1",
        userId: "user-1",
        path: "gs://media-bucket/media/user-1/media_asset-1/CP-Demo_Video.mov",
        type: "video",
        status: "ready",
        filename: "CP-Demo_Video.mov",
        mimeType: "video/quicktime",
        sizeBytes: 3495003117n,
      }),
      update: expect.objectContaining({
        path: "gs://media-bucket/media/user-1/media_asset-1/CP-Demo_Video.mov",
        type: "video",
        status: "ready",
        filename: "CP-Demo_Video.mov",
        mimeType: "video/quicktime",
        sizeBytes: 3495003117n,
      }),
    });
  });

  it("falls back to recovering legacy local-user uploads across prior user prefixes", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");

    mediaStorageMocks.getMetadata.mockResolvedValue([
      {
        contentType: "video/mp4",
        size: "1024",
        timeCreated: "2026-03-17T19:20:00.000Z",
        updated: "2026-03-17T19:21:00.000Z",
      },
    ]);
    mediaStorageMocks.getFiles
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          {
            getMetadata: mediaStorageMocks.getMetadata,
            name: "media/old-random-user/media_asset-2/demo.mp4",
          },
        ],
      ]);
    mediaStorageMocks.upsert.mockResolvedValue({});

    const restoredCount = await reconcileMediaAssetsFromStorage("local-user");

    expect(restoredCount).toBe(1);
    expect(mediaStorageMocks.getFiles).toHaveBeenNthCalledWith(1, {
      prefix: "media/local-user/",
    });
    expect(mediaStorageMocks.getFiles).toHaveBeenNthCalledWith(2, {
      prefix: "media/",
    });
    expect(mediaStorageMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "local-user",
          path: "gs://media-bucket/media/old-random-user/media_asset-2/demo.mp4",
        }),
      }),
    );
  });
});
