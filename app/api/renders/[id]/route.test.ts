import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    render: {
      findFirst: vi.fn(),
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

import { GET, HEAD } from "@/app/api/renders/[id]/route";

const testUserId = "test-user-render-preview";
const testRenderRoot = path.join(process.cwd(), "renders", testUserId);
const sampleRenderPath = path.join(testRenderRoot, "job-1", "sample.mp4");
const sampleRenderBody = "abcdefghijklmnopqrstuvwxyz";

describe("/api/renders/[id]", () => {
  beforeEach(async () => {
    routeMocks.prisma.render.findFirst.mockReset();
    routeMocks.resolveUser.mockReset();

    await fs.mkdir(path.dirname(sampleRenderPath), { recursive: true });
    await fs.writeFile(sampleRenderPath, sampleRenderBody, "utf8");

    routeMocks.resolveUser.mockResolvedValue({ id: testUserId });
    routeMocks.prisma.render.findFirst.mockResolvedValue({
      id: "render-1",
      userId: testUserId,
      path: sampleRenderPath,
    });
  });

  afterEach(async () => {
    await fs.rm(testRenderRoot, { recursive: true, force: true });
  });

  it("streams the full file without an empty content-range header", async () => {
    const response = await GET(new Request("http://localhost/api/renders/render-1"), {
      params: Promise.resolve({ id: "render-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(response.headers.get("Content-Length")).toBe(String(sampleRenderBody.length));
    expect(await response.text()).toBe(sampleRenderBody);
  });

  it("supports suffix byte ranges used for mp4 metadata lookups", async () => {
    const response = await GET(
      new Request("http://localhost/api/renders/render-1", {
        headers: {
          range: "bytes=-4",
        },
      }),
      {
        params: Promise.resolve({ id: "render-1" }),
      },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes ${sampleRenderBody.length - 4}-${sampleRenderBody.length - 1}/${sampleRenderBody.length}`);
    expect(await response.text()).toBe("wxyz");
  });

  it("returns metadata on HEAD without streaming the body", async () => {
    const response = await HEAD(new Request("http://localhost/api/renders/render-1", { method: "HEAD" }), {
      params: Promise.resolve({ id: "render-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe(String(sampleRenderBody.length));
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(await response.text()).toBe("");
  });
});
