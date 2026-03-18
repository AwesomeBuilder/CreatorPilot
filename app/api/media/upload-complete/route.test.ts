import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  resolveUser: vi.fn(),
  getStoredFileMetadata: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

vi.mock("@/lib/storage", () => ({
  getStoredFileMetadata: routeMocks.getStoredFileMetadata,
}));

import { POST } from "@/app/api/media/upload-complete/route";

describe("POST /api/media/upload-complete", () => {
  beforeEach(() => {
    routeMocks.prisma.mediaAsset.findFirst.mockReset();
    routeMocks.prisma.mediaAsset.update.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.getStoredFileMetadata.mockReset();
  });

  it("marks an uploaded object ready and refreshes metadata", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      userId: "user-1",
      path: "gs://media-bucket/media/user-1/asset-1/demo.mp4",
      type: "video",
      status: "pending",
      filename: "demo.mp4",
      mimeType: "application/octet-stream",
      sizeBytes: 100,
      createdAt: new Date("2026-03-17T00:00:00.000Z"),
      updatedAt: new Date("2026-03-17T00:00:00.000Z"),
    });
    routeMocks.getStoredFileMetadata.mockResolvedValue({
      exists: true,
      contentType: "video/mp4",
      sizeBytes: 104857600,
      updatedAt: "2026-03-17T00:00:00.000Z",
    });
    routeMocks.prisma.mediaAsset.update.mockImplementation(async ({ data }) => ({
      id: "asset-1",
      userId: "user-1",
      path: "gs://media-bucket/media/user-1/asset-1/demo.mp4",
      type: "video",
      status: data.status,
      filename: "demo.mp4",
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      createdAt: new Date("2026-03-17T00:00:00.000Z"),
      updatedAt: new Date("2026-03-17T00:00:00.000Z"),
    }));

    const response = await POST(
      new Request("http://localhost/api/media/upload-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: "asset-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      asset: {
        id: "asset-1",
        path: "gs://media-bucket/media/user-1/asset-1/demo.mp4",
        type: "video",
        status: "ready",
        filename: "demo.mp4",
        mimeType: "video/mp4",
        sizeBytes: 104857600,
      },
    });
  });

  it("marks the asset failed when the uploaded object is missing", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      userId: "user-1",
      path: "gs://media-bucket/media/user-1/asset-1/demo.mp4",
      type: "video",
      status: "pending",
      filename: "demo.mp4",
      mimeType: "video/mp4",
      sizeBytes: 100,
      createdAt: new Date("2026-03-17T00:00:00.000Z"),
      updatedAt: new Date("2026-03-17T00:00:00.000Z"),
    });
    routeMocks.getStoredFileMetadata.mockResolvedValue({
      exists: false,
      contentType: null,
      sizeBytes: null,
      updatedAt: null,
    });
    routeMocks.prisma.mediaAsset.update.mockImplementation(async () => ({
      id: "asset-1",
      userId: "user-1",
      path: "gs://media-bucket/media/user-1/asset-1/demo.mp4",
      type: "video",
      status: "failed",
      filename: "demo.mp4",
      mimeType: "video/mp4",
      sizeBytes: 100,
      createdAt: new Date("2026-03-17T00:00:00.000Z"),
      updatedAt: new Date("2026-03-17T00:00:00.000Z"),
    }));

    const response = await POST(
      new Request("http://localhost/api/media/upload-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: "asset-1" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Uploaded media object was not found.",
      asset: {
        id: "asset-1",
        path: "gs://media-bucket/media/user-1/asset-1/demo.mp4",
        type: "video",
        status: "failed",
        filename: "demo.mp4",
        mimeType: "video/mp4",
        sizeBytes: 100,
      },
    });
  });
});
