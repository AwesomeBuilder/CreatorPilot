import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryboardPlan, Trend } from "@/lib/types";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    job: {
      update: vi.fn(),
    },
  },
  appendJobLog: vi.fn(),
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  resolveUser: vi.fn(),
  runStoryboardWorkflow: vi.fn(),
  runRenderWorkflow: vi.fn(),
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  createCreatorPilotOrchestrator: () => ({
    runStoryboardWorkflow: routeMocks.runStoryboardWorkflow,
    runRenderWorkflow: routeMocks.runRenderWorkflow,
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/jobs", () => ({
  appendJobLog: routeMocks.appendJobLog,
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

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
    candidates: [],
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
    routeMocks.prisma.job.update.mockReset();
    routeMocks.appendJobLog.mockReset();
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.runStoryboardWorkflow.mockReset();
    routeMocks.runRenderWorkflow.mockReset();
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
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.runStoryboardWorkflow.mockResolvedValue({
      selectedMediaAssets: [],
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
    expect(await response.json()).toEqual({ error: "No valid media assets found for rendering." });
  });

  it("returns 400 when storyboard coverage still blocks rendering", async () => {
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    const storyboard = makeStoryboard({
      shouldBlock: true,
      coverageSummary: "Upload more relevant media before rendering.",
    });

    routeMocks.runStoryboardWorkflow.mockResolvedValue({
      selectedMediaAssets: [{ id: "asset-1", path: "/tmp/input-a.mp4", type: "video" }],
      storyboard,
      assessment: {
        status: "irrelevant",
        confidence: 0.92,
        summary: storyboard.coverageSummary,
        matchedSignals: [],
        shouldBlock: true,
        coverageScore: 31,
        requiresGeneratedSupport: false,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: ["asset-1"],
          preference: "shorts",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Upload more relevant media before rendering.",
      assessment: {
        status: "irrelevant",
        confidence: 0.92,
        summary: storyboard.coverageSummary,
        matchedSignals: [],
        shouldBlock: true,
        coverageScore: 31,
        requiresGeneratedSupport: false,
      },
      storyboard,
    });
  });

  it("rejects storyboards that reference unselected assets", async () => {
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.runStoryboardWorkflow.mockResolvedValue({
      selectedMediaAssets: [{ id: "asset-1", path: "/tmp/input-a.mp4", type: "video" }],
      storyboard: makeStoryboard({
        beats: [
          {
            ...makeStoryboard().beats[0],
            selectedAssetId: "asset-2",
          },
          ...makeStoryboard().beats.slice(1),
        ],
      }),
      assessment: {
        status: "relevant",
        confidence: 0.82,
        summary: "Looks fine.",
        matchedSignals: ["workflow"],
        shouldBlock: false,
        coverageScore: 78,
        requiresGeneratedSupport: false,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/render", {
        method: "POST",
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: ["asset-1"],
          preference: "shorts",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Storyboard references media that is not part of the selected assets." });
  });

  it("queues render execution and delegates the background work to the orchestrator", async () => {
    const storyboard = makeStoryboard();

    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.runStoryboardWorkflow.mockResolvedValue({
      memory: { summary: "Creator profile summary." },
      selectedMediaAssets: [{ id: "asset-1", path: "/tmp/input-a.mp4", type: "video" }],
      storyboard,
      assessment: {
        status: "relevant",
        confidence: 0.82,
        summary: storyboard.coverageSummary,
        matchedSignals: ["workflow", "creator"],
        shouldBlock: false,
        coverageScore: 78,
        requiresGeneratedSupport: false,
      },
    });
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.runRenderWorkflow.mockResolvedValue({
      renderOutput: {
        format: "shorts",
        reason: "Portrait source.",
        variants: [{ variantIndex: 1, path: "/tmp/render.mp4", duration: 41, hasAudio: true }],
      },
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
          mediaAssetIds: ["asset-1"],
          preference: "shorts",
          storyboard,
        }),
      }),
    );

    expect(await response.json()).toEqual({ jobId: "job-1", status: "queued" });

    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(routeMocks.runRenderWorkflow).toHaveBeenCalledWith({
      user: {
        id: "user-1",
        niche: "AI & Tech",
        tone: "clear",
        timezone: "America/Los_Angeles",
      },
      jobId: "job-1",
      log: expect.any(Function),
      input: {
        trend,
        idea,
        mediaAssetIds: ["asset-1"],
        preference: "shorts",
        storyboard,
      },
      preparedState: {
        memory: { summary: "Creator profile summary." },
        selectedMediaAssets: [{ id: "asset-1", path: "/tmp/input-a.mp4", type: "video" }],
        storyboard,
        assessment: {
          status: "relevant",
          confidence: 0.82,
          summary: storyboard.coverageSummary,
          matchedSignals: ["workflow", "creator"],
          shouldBlock: false,
          coverageScore: 78,
          requiresGeneratedSupport: false,
        },
      },
    });
    expect(result).toEqual({
      format: "shorts",
      reason: "Portrait source.",
      variants: [{ variantIndex: 1, path: "/tmp/render.mp4", duration: 41, hasAudio: true }],
    });
  });

  it("returns JSON when an unexpected render error is thrown", async () => {
    const storyboard = makeStoryboard();

    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.runStoryboardWorkflow.mockResolvedValue({
      selectedMediaAssets: [{ id: "asset-1", path: "/tmp/input-a.mp4", type: "video" }],
      storyboard,
      assessment: {
        status: "relevant",
        confidence: 0.82,
        summary: storyboard.coverageSummary,
        matchedSignals: ["workflow", "creator"],
        shouldBlock: false,
        coverageScore: 78,
        requiresGeneratedSupport: false,
      },
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
});
