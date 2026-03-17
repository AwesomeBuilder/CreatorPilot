import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryboardPlan, Trend } from "@/lib/types";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      findMany: vi.fn(),
    },
    job: {
      update: vi.fn(),
    },
    render: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  appendJobLog: vi.fn(),
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  renderVideoVariants: vi.fn(),
  buildStoryboardPlan: vi.fn(),
  storyboardPlanToAssessment: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/jobs", () => ({
  appendJobLog: routeMocks.appendJobLog,
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/render", () => ({
  renderVideoVariants: routeMocks.renderVideoVariants,
}));

vi.mock("@/lib/storyboard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storyboard")>("@/lib/storyboard");
  return {
    ...actual,
    buildStoryboardPlan: routeMocks.buildStoryboardPlan,
    storyboardPlanToAssessment: routeMocks.storyboardPlanToAssessment,
  };
});

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/render/route";

const trend: Trend = {
  trendTitle: "OpenAI ships a new creator workflow",
  summary: "A fresh workflow update is driving creator attention.",
  links: ["https://example.com/story"],
};

const idea = {
  videoTitle: "Why this creator workflow matters",
  hook: "This changes how fast you can ship explainers.",
  bulletOutline: ["What changed", "Why it matters", "How to use it"],
  cta: "Follow for more creator tooling breakdowns.",
};

function makeStoryboard(overrides?: Partial<StoryboardPlan>): StoryboardPlan {
  return {
    format: "shorts",
    coverageScore: 78,
    coverageSummary: "Coverage is strong enough to render directly from the uploaded media.",
    shouldBlock: false,
    requiresMoreRelevantMedia: false,
    generatedSupportEnabled: true,
    generatedSupportUsed: false,
    assetSummaries: [
      {
        assetId: "asset-1",
        assetPath: "/tmp/input-a.mp4",
        type: "video",
        compactSummary: "Shows the product workflow.",
        bestFitScore: 84,
        topCues: ["workflow", "editor", "creator"],
        shotCount: 3,
      },
    ],
    candidates: [
      {
        candidateId: "asset-1:shot-1",
        assetId: "asset-1",
        assetPath: "/tmp/input-a.mp4",
        assetType: "video",
        source: "user",
        label: "input-a.mp4 @ 0:03",
        durationSeconds: 12,
        frameTimeSeconds: 3,
        shotStartSeconds: 1.8,
        shotEndSeconds: 4.8,
        visualSummary: "Editor UI showing the workflow.",
        compactSummary: "Workflow UI.",
        ocrText: ["Storyboard", "Render"],
        uiText: ["Editor"],
        logos: ["OpenAI"],
        entities: ["Creator Pilot"],
        topicCues: ["workflow", "creator"],
        fitScore: 82,
        fitReason: "The frame directly shows the workflow being discussed.",
        energyScore: 68,
        bestUseCases: ["hook", "proof"],
      },
    ],
    beats: [
      {
        beatId: "beat-1",
        order: 1,
        purpose: "hook",
        title: idea.videoTitle,
        caption: idea.hook,
        narration: idea.hook,
        durationSeconds: 3.4,
        visualIntent: "A strong opening visual.",
        coverageLevel: "strong",
        matchScore: 82,
        selectedCandidateId: "asset-1:shot-1",
        selectedAssetId: "asset-1",
        selectedAssetPath: "/tmp/input-a.mp4",
        mediaSource: "user",
        assetType: "video",
        shotStartSeconds: 1.8,
        shotEndSeconds: 4.8,
        matchReason: "The workflow UI matches the hook.",
        generatedVisualStatus: "not-needed",
      },
      {
        beatId: "beat-2",
        order: 2,
        purpose: "context",
        title: "What changed",
        caption: "What changed",
        narration: "What changed",
        durationSeconds: 3.1,
        visualIntent: "Context visual.",
        coverageLevel: "usable",
        matchScore: 74,
        selectedCandidateId: "asset-1:shot-1",
        selectedAssetId: "asset-1",
        selectedAssetPath: "/tmp/input-a.mp4",
        mediaSource: "user",
        assetType: "video",
        shotStartSeconds: 1.8,
        shotEndSeconds: 4.8,
        matchReason: "Same workflow clip supports the context beat.",
        generatedVisualStatus: "not-needed",
      },
      {
        beatId: "beat-3",
        order: 3,
        purpose: "proof",
        title: "Why it matters",
        caption: "Why it matters",
        narration: "Why it matters",
        durationSeconds: 3.1,
        visualIntent: "Proof visual.",
        coverageLevel: "usable",
        matchScore: 71,
        selectedCandidateId: "asset-1:shot-1",
        selectedAssetId: "asset-1",
        selectedAssetPath: "/tmp/input-a.mp4",
        mediaSource: "user",
        assetType: "video",
        shotStartSeconds: 1.8,
        shotEndSeconds: 4.8,
        matchReason: "Same workflow clip supports the proof beat.",
        generatedVisualStatus: "not-needed",
      },
      {
        beatId: "beat-4",
        order: 4,
        purpose: "cta",
        title: "Close strong",
        caption: idea.cta,
        narration: idea.cta,
        durationSeconds: 2.4,
        visualIntent: "Close visual.",
        coverageLevel: "usable",
        matchScore: 60,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        mediaSource: "synthetic",
        assetType: "none",
        matchReason: "A clean end card closes more clearly.",
        generatedVisualStatus: "not-needed",
      },
    ],
    ...overrides,
  };
}

describe("POST /api/render", () => {
  beforeEach(() => {
    delete process.env.RUN_RENDER_JOBS_INLINE;
    routeMocks.prisma.mediaAsset.findMany.mockReset();
    routeMocks.prisma.job.update.mockReset();
    routeMocks.prisma.render.create.mockReset();
    routeMocks.prisma.$transaction.mockReset();
    routeMocks.appendJobLog.mockReset();
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.renderVideoVariants.mockReset();
    routeMocks.buildStoryboardPlan.mockReset();
    routeMocks.storyboardPlanToAssessment.mockReset();
    routeMocks.resolveUser.mockReset();
  });

  it("returns 400 for invalid render requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          trend: {
            trendTitle: "",
            summary: "",
            links: [],
          },
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
          trend,
          idea,
          mediaAssetIds: ["asset-1"],
          preference: "auto",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No valid media assets found for rendering." });
  });

  it("returns 400 when storyboard coverage blocks the selected assets", async () => {
    const blockedStoryboard = makeStoryboard({
      coverageScore: 24,
      coverageSummary: "Coverage is too weak to produce a coherent explainer. Upload more topic-specific screenshots or clips before rendering.",
      shouldBlock: true,
      requiresMoreRelevantMedia: true,
    });

    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "asset-1", path: "/tmp/input-a.png", type: "image" }]);
    routeMocks.buildStoryboardPlan.mockResolvedValue(blockedStoryboard);
    routeMocks.storyboardPlanToAssessment.mockReturnValue({
      status: "irrelevant",
      confidence: 0.24,
      summary: blockedStoryboard.coverageSummary,
      matchedSignals: ["workflow"],
      shouldBlock: true,
      coverageScore: 24,
      requiresGeneratedSupport: false,
    });

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: ["asset-1"],
          preference: "auto",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: blockedStoryboard.coverageSummary,
      assessment: {
        status: "irrelevant",
        confidence: 0.24,
        summary: blockedStoryboard.coverageSummary,
        matchedSignals: ["workflow"],
        shouldBlock: true,
        coverageScore: 24,
        requiresGeneratedSupport: false,
      },
      storyboard: blockedStoryboard,
    });
  });

  it("passes the storyboard into the renderer and persists the generated variants", async () => {
    const storyboard = makeStoryboard();

    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      { id: "asset-1", path: "/tmp/input-a.mp4", type: "video" },
      { id: "asset-2", path: "/tmp/input-b.mp4", type: "video" },
    ]);
    routeMocks.storyboardPlanToAssessment.mockReturnValue({
      status: "relevant",
      confidence: 0.82,
      summary: storyboard.coverageSummary,
      matchedSignals: ["workflow", "creator"],
      shouldBlock: false,
      coverageScore: 78,
      requiresGeneratedSupport: false,
    });
    routeMocks.prisma.render.create.mockReturnValueOnce("render-query-1").mockReturnValueOnce("render-query-2").mockReturnValueOnce("render-query-3");
    routeMocks.prisma.$transaction.mockResolvedValue(undefined);
    routeMocks.renderVideoVariants.mockResolvedValue({
      format: "shorts",
      reason: storyboard.coverageSummary,
      storyboard,
      variants: [
        { variantIndex: 1, path: "/tmp/out-1.mp4", duration: 12 },
        { variantIndex: 2, path: "/tmp/out-2.mp4", duration: 12 },
        { variantIndex: 3, path: "/tmp/out-3.mp4", duration: 12 },
      ],
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: ["asset-1", "asset-2"],
          preference: "shorts",
          storyboard,
        }),
      }),
    );

    expect(await response.json()).toEqual({ jobId: "job-1", status: "queued" });

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(routeMocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          {
            id: {
              in: ["asset-1", "asset-2"],
            },
          },
          {
            path: {
              in: ["asset-1", "asset-2"],
            },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    expect(routeMocks.buildStoryboardPlan).not.toHaveBeenCalled();
    expect(routeMocks.renderVideoVariants).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      title: idea.videoTitle,
      onProgress: expect.any(Function),
      storyboard: expect.objectContaining({
        ...storyboard,
        beats: expect.arrayContaining(
          storyboard.beats.map((beat) =>
            expect.objectContaining({
              ...beat,
              supportingVisuals: expect.any(Array),
            }),
          ),
        ),
      }),
    });
    expect(routeMocks.prisma.render.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: "user-1",
        jobId: "job-1",
        variantIndex: 1,
        path: "/tmp/out-1.mp4",
        duration: 12,
      },
    });
    expect(routeMocks.prisma.$transaction).toHaveBeenCalledWith(["render-query-1", "render-query-2", "render-query-3"]);
    expect(result).toEqual({
      format: "shorts",
      reason: storyboard.coverageSummary,
      storyboard,
      variants: [
        { variantIndex: 1, path: "/tmp/out-1.mp4", duration: 12 },
        { variantIndex: 2, path: "/tmp/out-2.mp4", duration: 12 },
        { variantIndex: 3, path: "/tmp/out-3.mp4", duration: 12 },
      ],
    });
  });

  it("can run the render inline when RUN_RENDER_JOBS_INLINE is enabled", async () => {
    process.env.RUN_RENDER_JOBS_INLINE = "true";
    const storyboard = makeStoryboard();

    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "asset-1", path: "/tmp/input-a.mp4", type: "video" }]);
    routeMocks.storyboardPlanToAssessment.mockReturnValue({
      status: "relevant",
      confidence: 0.82,
      summary: storyboard.coverageSummary,
      matchedSignals: ["workflow", "creator"],
      shouldBlock: false,
      coverageScore: 78,
      requiresGeneratedSupport: false,
    });
    routeMocks.prisma.job.update.mockResolvedValue(undefined);
    routeMocks.appendJobLog.mockResolvedValue(undefined);
    routeMocks.prisma.render.create.mockReturnValueOnce("render-query-1");
    routeMocks.prisma.$transaction.mockResolvedValue(undefined);
    routeMocks.renderVideoVariants.mockResolvedValue({
      format: "shorts",
      reason: storyboard.coverageSummary,
      storyboard,
      variants: [{ variantIndex: 1, path: "/tmp/out-1.mp4", duration: 12 }],
      audioStatus: "missing",
      audioError: "Generated narration is disabled by RENDER_ENABLE_GENERATED_NARRATION.",
    });

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: ["asset-1"],
          preference: "shorts",
          storyboard,
        }),
      }),
    );

    expect(await response.json()).toEqual({ jobId: "job-1", status: "complete" });
    expect(routeMocks.runJobInBackground).not.toHaveBeenCalled();
    expect(routeMocks.prisma.job.update).toHaveBeenNthCalledWith(1, {
      where: { id: "job-1" },
      data: { status: "running" },
    });
    expect(routeMocks.prisma.job.update).toHaveBeenNthCalledWith(2, {
      where: { id: "job-1" },
      data: {
        status: "complete",
        outputJson: JSON.stringify({
          format: "shorts",
          reason: storyboard.coverageSummary,
          storyboard,
          variants: [{ variantIndex: 1, path: "/tmp/out-1.mp4", duration: 12 }],
          audioStatus: "missing",
          audioError: "Generated narration is disabled by RENDER_ENABLE_GENERATED_NARRATION.",
        }),
      },
    });
    expect(routeMocks.renderVideoVariants).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      title: idea.videoTitle,
      onProgress: expect.any(Function),
      storyboard: expect.objectContaining({
        ...storyboard,
        beats: expect.arrayContaining(
          storyboard.beats.map((beat) =>
            expect.objectContaining({
              ...beat,
              supportingVisuals: expect.any(Array),
            }),
          ),
        ),
      }),
    });
  });

  it("returns JSON when an unexpected render error is thrown", async () => {
    const storyboard = makeStoryboard();

    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "asset-1", path: "/tmp/input-a.mp4", type: "video" }]);
    routeMocks.storyboardPlanToAssessment.mockReturnValue({
      status: "relevant",
      confidence: 0.82,
      summary: storyboard.coverageSummary,
      matchedSignals: ["workflow", "creator"],
      shouldBlock: false,
      coverageScore: 78,
      requiresGeneratedSupport: false,
    });
    routeMocks.createJob.mockRejectedValue(new Error("upstream request timeout"));

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: ["asset-1"],
          preference: "shorts",
          storyboard,
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "upstream request timeout" });
  });

  it("resolves render assets when the request sends stored media paths", async () => {
    const assetPath = "/app/uploads/user-1/manual-123/input-a.mp4";
    const storyboard = makeStoryboard({
      assetSummaries: [
        {
          assetId: "asset-1",
          assetPath,
          type: "video",
          compactSummary: "Shows the product workflow.",
          bestFitScore: 84,
          topCues: ["workflow", "editor", "creator"],
          shotCount: 3,
        },
      ],
      candidates: [
        {
          candidateId: "asset-1:shot-1",
          assetId: "asset-1",
          assetPath,
          assetType: "video",
          source: "user",
          label: "input-a.mp4 @ 0:03",
          durationSeconds: 12,
          frameTimeSeconds: 3,
          shotStartSeconds: 1.8,
          shotEndSeconds: 4.8,
          visualSummary: "Editor UI showing the workflow.",
          compactSummary: "Workflow UI.",
          ocrText: ["Storyboard", "Render"],
          uiText: ["Editor"],
          logos: ["OpenAI"],
          entities: ["Creator Pilot"],
          topicCues: ["workflow", "creator"],
          fitScore: 82,
          fitReason: "The frame directly shows the workflow being discussed.",
          energyScore: 68,
          bestUseCases: ["hook", "proof"],
        },
      ],
      beats: makeStoryboard().beats.map((beat) => ({
        ...beat,
        selectedAssetPath: beat.selectedAssetPath ? assetPath : null,
      })),
    });

    routeMocks.createJob.mockResolvedValue({ id: "job-2", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "asset-1", path: assetPath, type: "video" }]);
    routeMocks.storyboardPlanToAssessment.mockReturnValue({
      status: "relevant",
      confidence: 0.82,
      summary: storyboard.coverageSummary,
      matchedSignals: ["workflow", "creator"],
      shouldBlock: false,
      coverageScore: 78,
      requiresGeneratedSupport: false,
    });
    routeMocks.renderVideoVariants.mockResolvedValue({
      format: "shorts",
      reason: storyboard.coverageSummary,
      storyboard,
      variants: [{ variantIndex: 1, path: "/tmp/out-1.mp4", duration: 12 }],
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
          trend,
          idea,
          mediaAssetIds: [assetPath],
          preference: "shorts",
          storyboard,
        }),
      }),
    );

    const log = vi.fn().mockResolvedValue(undefined);
    await backgroundTask?.({ log });

    expect(routeMocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          {
            id: {
              in: [assetPath],
            },
          },
          {
            path: {
              in: [assetPath],
            },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    expect(routeMocks.renderVideoVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        onProgress: expect.any(Function),
        storyboard: expect.objectContaining({
          beats: expect.arrayContaining([
            expect.objectContaining({
              selectedAssetId: "asset-1",
              selectedAssetPath: assetPath,
            }),
          ]),
        }),
      }),
    );
  });
});
