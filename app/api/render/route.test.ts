import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      findMany: vi.fn(),
    },
    render: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  renderVideoVariants: vi.fn(),
  assessMediaRelevance: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/jobs", () => ({
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/render", () => ({
  renderVideoVariants: routeMocks.renderVideoVariants,
}));

vi.mock("@/lib/media-relevance", () => ({
  assessMediaRelevance: routeMocks.assessMediaRelevance,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/render/route";

describe("POST /api/render", () => {
  beforeEach(() => {
    routeMocks.prisma.mediaAsset.findMany.mockReset();
    routeMocks.prisma.render.create.mockReset();
    routeMocks.prisma.$transaction.mockReset();
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.renderVideoVariants.mockReset();
    routeMocks.assessMediaRelevance.mockReset();
    routeMocks.resolveUser.mockReset();
  });

  it("returns 400 for invalid render requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          idea: {
            videoTitle: "",
            hook: "",
            cta: "",
          },
          mediaAssetIds: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when no valid media assets exist", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([]);

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          idea: {
            videoTitle: "Idea",
            hook: "Hook",
            bulletOutline: [],
            cta: "CTA",
          },
          mediaAssetIds: ["asset-1"],
          preference: "auto",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No valid media assets found for rendering." });
  });

  it("returns 400 when the media assessment blocks the selected assets", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "asset-1", path: "/tmp/input-a.png", type: "image" }]);
    routeMocks.assessMediaRelevance.mockResolvedValue({
      status: "irrelevant",
      confidence: 0.91,
      summary: "Upload media that matches the selected idea before rendering.",
      matchedSignals: ["Copilot Tasks"],
      shouldBlock: true,
    });

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          idea: {
            videoTitle: "Idea",
            hook: "Hook",
            bulletOutline: [],
            cta: "CTA",
          },
          mediaAssetIds: ["asset-1"],
          preference: "auto",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Upload media that matches the selected idea before rendering.",
      assessment: {
        status: "irrelevant",
        confidence: 0.91,
        summary: "Upload media that matches the selected idea before rendering.",
        matchedSignals: ["Copilot Tasks"],
        shouldBlock: true,
      },
    });
  });

  it("resolves asset paths, renders variants, and persists them in a transaction", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      { id: "asset-1", path: "/tmp/input-a.mp4", type: "video" },
      { id: "asset-2", path: "/tmp/input-b.mp4", type: "video" },
    ]);
    routeMocks.assessMediaRelevance.mockResolvedValue({
      status: "relevant",
      confidence: 0.88,
      summary: "Looks good.",
      matchedSignals: ["ByteDance"],
      shouldBlock: false,
    });
    routeMocks.prisma.render.create
      .mockReturnValueOnce("render-query-1")
      .mockReturnValueOnce("render-query-2")
      .mockReturnValueOnce("render-query-3");
    routeMocks.prisma.$transaction.mockResolvedValue(undefined);

    routeMocks.renderVideoVariants.mockResolvedValue({
      format: "shorts",
      reason: "Auto-selected Shorts because source media is portrait.",
      variants: [
        { variantIndex: 1, path: "/tmp/out-1.mp4", duration: 18 },
        { variantIndex: 2, path: "/tmp/out-2.mp4", duration: 18 },
        { variantIndex: 3, path: "/tmp/out-3.mp4", duration: 18 },
      ],
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          idea: {
            videoTitle: "Idea",
            hook: "Hook",
            bulletOutline: ["Point 1"],
            cta: "CTA",
          },
          mediaAssetIds: ["asset-1", "asset-2"],
          preference: "shorts",
        }),
      }),
    );

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(routeMocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        id: {
          in: ["asset-1", "asset-2"],
        },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(routeMocks.renderVideoVariants).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      mediaPaths: ["/tmp/input-a.mp4", "/tmp/input-b.mp4"],
      title: "Idea",
      hook: "Hook",
      bulletOutline: ["Point 1"],
      cta: "CTA",
      preference: "shorts",
    });
    expect(routeMocks.prisma.render.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: "user-1",
        jobId: "job-1",
        variantIndex: 1,
        path: "/tmp/out-1.mp4",
        duration: 18,
      },
    });
    expect(routeMocks.prisma.$transaction).toHaveBeenCalledWith(["render-query-1", "render-query-2", "render-query-3"]);
    expect(result).toEqual({
      format: "shorts",
      reason: "Auto-selected Shorts because source media is portrait.",
      variants: [
        { variantIndex: 1, path: "/tmp/out-1.mp4", duration: 18 },
        { variantIndex: 2, path: "/tmp/out-2.mp4", duration: 18 },
        { variantIndex: 3, path: "/tmp/out-3.mp4", duration: 18 },
      ],
    });
  });
});
