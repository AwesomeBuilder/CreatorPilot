import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/user", () => ({
  LOCAL_USER_ID: "local-user",
  resolveUser: routeMocks.resolveUser,
}));

import { GET, POST } from "@/app/api/media/route";

const testUserId = "test-user-media-route";
const testUploadsRoot = path.join(process.cwd(), "uploads", testUserId);

describe("/api/media", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    routeMocks.prisma.mediaAsset.create.mockReset();
    routeMocks.prisma.mediaAsset.count.mockReset();
    routeMocks.prisma.mediaAsset.findMany.mockReset();
    routeMocks.prisma.mediaAsset.upsert.mockReset();
    routeMocks.prisma.mediaAsset.updateMany.mockReset();
    routeMocks.resolveUser.mockReset();
  });

  afterEach(async () => {
    await fs.rm(testUploadsRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns serialized assets plus the active upload mode", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");
    routeMocks.resolveUser.mockResolvedValue({ id: testUserId });
    routeMocks.prisma.mediaAsset.count.mockResolvedValue(1);
    routeMocks.prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        userId: testUserId,
        path: "gs://media-bucket/media/test-user-media-route/asset-1/demo.mp4",
        type: "video",
        status: "ready",
        filename: "Demo Clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1048576,
        createdAt: new Date("2026-03-17T00:00:00.000Z"),
        updatedAt: new Date("2026-03-17T00:00:00.000Z"),
      },
    ]);

    const response = await GET(new Request("http://localhost/api/media"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assets: [
        {
          id: "asset-1",
          path: "gs://media-bucket/media/test-user-media-route/asset-1/demo.mp4",
          type: "video",
          status: "ready",
          filename: "Demo Clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 1048576,
        },
      ],
      uploadMode: "direct",
    });
    expect(routeMocks.prisma.mediaAsset.count).toHaveBeenCalledWith({
      where: { userId: testUserId },
    });
    expect(routeMocks.prisma.mediaAsset.updateMany).toHaveBeenCalled();
  });

  it("hides older recovered legacy prefixes for local-user media listings", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");
    routeMocks.resolveUser.mockResolvedValue({ id: "local-user" });
    routeMocks.prisma.mediaAsset.count.mockResolvedValue(2);
    routeMocks.prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: "asset-new",
        userId: "local-user",
        path: "gs://media-bucket/media/newer-user/asset-new/demo.mp4",
        type: "video",
        status: "ready",
        filename: "Demo Clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 4096,
        createdAt: new Date("2026-03-17T20:20:00.000Z"),
        updatedAt: new Date("2026-03-17T20:21:00.000Z"),
      },
      {
        id: "asset-old",
        userId: "local-user",
        path: "gs://media-bucket/media/older-user/asset-old/demo.mp4",
        type: "video",
        status: "ready",
        filename: "Demo Clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 2048,
        createdAt: new Date("2026-03-17T19:20:00.000Z"),
        updatedAt: new Date("2026-03-17T19:21:00.000Z"),
      },
    ]);

    const response = await GET(new Request("http://localhost/api/media"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assets: [
        {
          id: "asset-new",
          path: "gs://media-bucket/media/newer-user/asset-new/demo.mp4",
          type: "video",
          status: "ready",
          filename: "Demo Clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 4096,
        },
      ],
      uploadMode: "direct",
    });
  });

  it("stores local uploads when direct mode is not configured", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: testUserId });
    routeMocks.prisma.mediaAsset.create.mockImplementation(async ({ data }) => ({
      id: "asset-1",
      createdAt: new Date("2026-03-17T00:00:00.000Z"),
      updatedAt: new Date("2026-03-17T00:00:00.000Z"),
      ...data,
    }));

    const formData = new FormData();
    formData.append("jobId", "job-1");
    formData.append("files", new File([Buffer.from("sample-video")], "sample.mp4", { type: "video/mp4" }));

    const response = await POST(
      new Request("http://localhost/api/media", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      jobId: string;
      uploaded: Array<{
        id: string;
        path: string;
        type: string;
        status: string;
        filename: string;
        mimeType: string;
        sizeBytes: number | null;
      }>;
    };

    expect(payload.jobId).toBe("job-1");
    expect(payload.uploaded).toHaveLength(1);
    expect(payload.uploaded[0]).toMatchObject({
      id: "asset-1",
      type: "video",
      status: "ready",
      filename: "sample.mp4",
      mimeType: "video/mp4",
      sizeBytes: 12,
    });
    expect(payload.uploaded[0]?.path).toContain(path.join("uploads", testUserId, "job-1"));
    await expect(fs.access(payload.uploaded[0]!.path)).resolves.toBeUndefined();
  });

  it("rejects multipart uploads when direct mode is enabled", async () => {
    vi.stubEnv("MEDIA_STORAGE_BUCKET", "media-bucket");

    const response = await POST(
      new Request("http://localhost/api/media", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Direct media uploads are enabled. Create an upload session instead.",
    });
  });
});
