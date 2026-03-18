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
  isCloudStoragePath: (filePath: string) => filePath.startsWith("gs://"),
  parseCloudStoragePath: (filePath: string) => {
    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(filePath);
    if (!match) {
      throw new Error(`Invalid Cloud Storage path: ${filePath}`);
    }

    return {
      bucketName: match[1],
      objectName: match[2],
    };
  },
}));

import { reconcileMediaAssetsFromStorage, selectPreferredLocalUserRecoveredMediaAssets } from "@/lib/media-storage";

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

  it("recovers only the most recent legacy prefix for local-user when multiple prior prefixes exist", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");

    mediaStorageMocks.getFiles
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          {
            getMetadata: vi.fn().mockResolvedValue([
              {
                contentType: "video/mp4",
                size: "1024",
                timeCreated: "2026-03-17T19:20:00.000Z",
                updated: "2026-03-17T19:21:00.000Z",
              },
            ]),
            name: "media/older-user/media_asset-2/demo.mp4",
          },
          {
            getMetadata: vi.fn().mockResolvedValue([
              {
                contentType: "video/mp4",
                size: "2048",
                timeCreated: "2026-03-17T20:20:00.000Z",
                updated: "2026-03-17T20:21:00.000Z",
              },
            ]),
            name: "media/newer-user/media_asset-3/demo.mp4",
          },
        ],
      ]);
    mediaStorageMocks.upsert.mockResolvedValue({});

    const restoredCount = await reconcileMediaAssetsFromStorage("local-user");

    expect(restoredCount).toBe(1);
    expect(mediaStorageMocks.upsert).toHaveBeenCalledTimes(1);
    expect(mediaStorageMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "local-user",
          path: "gs://media-bucket/media/newer-user/media_asset-3/demo.mp4",
        }),
      }),
    );
  });
});

describe("selectPreferredLocalUserRecoveredMediaAssets", () => {
  it("keeps only the most recently updated legacy prefix for local-user assets", () => {
    const assets = selectPreferredLocalUserRecoveredMediaAssets("local-user", [
      {
        id: "asset-1",
        userId: "local-user",
        path: "gs://media-bucket/media/older-user/asset-1/demo.mp4",
        createdAt: new Date("2026-03-17T19:20:00.000Z"),
        updatedAt: new Date("2026-03-17T19:21:00.000Z"),
      },
      {
        id: "asset-2",
        userId: "local-user",
        path: "gs://media-bucket/media/newer-user/asset-2/demo.mp4",
        createdAt: new Date("2026-03-17T20:20:00.000Z"),
        updatedAt: new Date("2026-03-17T20:21:00.000Z"),
      },
    ]);

    expect(assets.map((asset) => asset.id)).toEqual(["asset-2"]);
  });

  it("leaves non-local or non-recoverable assets unchanged", () => {
    const assets = [
      {
        id: "asset-1",
        userId: "user-1",
        path: "/tmp/demo.mp4",
        createdAt: new Date("2026-03-17T19:20:00.000Z"),
        updatedAt: new Date("2026-03-17T19:21:00.000Z"),
      },
      {
        id: "asset-2",
        userId: "user-1",
        path: "/tmp/demo-2.mp4",
        createdAt: new Date("2026-03-17T20:20:00.000Z"),
        updatedAt: new Date("2026-03-17T20:21:00.000Z"),
      },
    ];

    expect(selectPreferredLocalUserRecoveredMediaAssets("user-1", assets)).toEqual(assets);
  });
});
