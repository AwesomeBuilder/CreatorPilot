import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  resolveUser: vi.fn(),
  createCloudStorageResumableUploadSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

vi.mock("@/lib/storage", () => ({
  createCloudStorageResumableUploadSession: routeMocks.createCloudStorageResumableUploadSession,
}));

import { POST } from "@/app/api/media/upload-session/route";

describe("POST /api/media/upload-session", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    routeMocks.prisma.mediaAsset.create.mockReset();
    routeMocks.prisma.mediaAsset.update.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.createCloudStorageResumableUploadSession.mockReset();
  });

  it("creates a pending asset row and returns a resumable upload URL", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.create.mockImplementation(async ({ data }) => ({
      createdAt: new Date("2026-03-17T00:00:00.000Z"),
      updatedAt: new Date("2026-03-17T00:00:00.000Z"),
      ...data,
    }));
    routeMocks.createCloudStorageResumableUploadSession.mockResolvedValue("https://storage.googleapis.com/upload-session");

    const response = await POST(
      new Request("https://creator-pilot.example/api/media/upload-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://creator-pilot.example",
        },
        body: JSON.stringify({
          filename: "Demo Clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 3495003117,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      assetId: string;
      uploadUrl: string;
      asset: {
        id: string;
        path: string;
        type: string;
        status: string;
        filename: string;
        mimeType: string;
        sizeBytes: number | null;
      };
    };

    expect(payload.uploadUrl).toBe("https://storage.googleapis.com/upload-session");
    expect(payload.asset).toMatchObject({
      id: payload.assetId,
      type: "video",
      status: "pending",
      filename: "Demo Clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 3495003117,
    });
    expect(payload.asset.path).toBe(`gs://media-bucket/media/user-1/${payload.assetId}/Demo_Clip.mp4`);
    expect(routeMocks.createCloudStorageResumableUploadSession).toHaveBeenCalledWith({
      bucketName: "media-bucket",
      objectName: `media/user-1/${payload.assetId}/Demo_Clip.mp4`,
      contentType: "video/mp4",
      origin: "https://creator-pilot.example",
      metadata: {
        mediaAssetId: payload.assetId,
        userId: "user-1",
      },
    });
  });

  it("rejects unsupported file types", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");

    const response = await POST(
      new Request("http://localhost/api/media/upload-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "notes.txt",
          sizeBytes: 128,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported file type: notes.txt" });
  });
});
