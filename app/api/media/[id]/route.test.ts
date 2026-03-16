import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { DELETE } from "@/app/api/media/[id]/route";

const testUserId = "test-user-media-delete";
const testUploadsRoot = path.join(process.cwd(), "uploads", testUserId);
const outsideTestFile = path.join(process.cwd(), "renders", "media-delete-route-outside.txt");

describe("DELETE /api/media/[id]", () => {
  beforeEach(() => {
    routeMocks.prisma.mediaAsset.findFirst.mockReset();
    routeMocks.prisma.mediaAsset.delete.mockReset();
    routeMocks.resolveUser.mockReset();
  });

  afterEach(async () => {
    await fs.rm(testUploadsRoot, { recursive: true, force: true });
    await fs.rm(outsideTestFile, { force: true });
  });

  it("returns 404 when the asset does not exist for the current user", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: testUserId });
    routeMocks.prisma.mediaAsset.findFirst.mockResolvedValue(null);

    const response = await DELETE(new Request("http://localhost/api/media/asset-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "asset-1" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Media asset not found" });
    expect(routeMocks.prisma.mediaAsset.delete).not.toHaveBeenCalled();
  });

  it("deletes the uploaded file and media asset record", async () => {
    const assetPath = path.join(testUploadsRoot, "job-1", "sample.png");
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(assetPath, "sample-media");

    routeMocks.resolveUser.mockResolvedValue({ id: testUserId });
    routeMocks.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      userId: testUserId,
      path: assetPath,
      type: "image",
    });
    routeMocks.prisma.mediaAsset.delete.mockResolvedValue({
      id: "asset-1",
    });

    const response = await DELETE(new Request("http://localhost/api/media/asset-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "asset-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deleted: {
        id: "asset-1",
        path: assetPath,
        type: "image",
      },
    });
    await expect(fs.access(assetPath)).rejects.toBeTruthy();
    expect(routeMocks.prisma.mediaAsset.delete).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
      },
    });
  });

  it("rejects deleting files outside the user's uploads directory", async () => {
    await fs.mkdir(path.dirname(outsideTestFile), { recursive: true });
    await fs.writeFile(outsideTestFile, "outside");

    routeMocks.resolveUser.mockResolvedValue({ id: testUserId });
    routeMocks.prisma.mediaAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      userId: testUserId,
      path: outsideTestFile,
      type: "image",
    });

    const response = await DELETE(new Request("http://localhost/api/media/asset-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "asset-1" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Media asset path is invalid" });
    expect(routeMocks.prisma.mediaAsset.delete).not.toHaveBeenCalled();
    await expect(fs.access(outsideTestFile)).resolves.toBeUndefined();
  });
});
