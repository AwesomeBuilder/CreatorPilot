import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  resolveUser: vi.fn(),
  runIdeaWorkflow: vi.fn(),
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  createCreatorPilotOrchestrator: () => ({
    runIdeaWorkflow: routeMocks.runIdeaWorkflow,
  }),
}));

vi.mock("@/lib/jobs", () => ({
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/ideas/route";

describe("POST /api/ideas", () => {
  beforeEach(() => {
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.runIdeaWorkflow.mockReset();
  });

  it("returns 400 for invalid requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          trend: {
            trendTitle: "",
            summary: "",
            links: ["not-a-url"],
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("queues trend-led idea generation through the orchestrator", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.runIdeaWorkflow.mockResolvedValue({
      selectedMediaAssets: [],
      ideasResult: {
        ideas: [
          {
            videoTitle: "Idea 1",
            hook: "Hook 1",
            bulletOutline: ["One", "Two", "Three"],
            cta: "CTA 1",
          },
        ],
        generationMode: "multi-idea",
        contextAssessment: {
          summary: "Trend provides enough context.",
          confidence: 88,
          requiresBrief: false,
          missingContextPrompts: [],
        },
        derivedContextTrend: {
          trendTitle: "OpenAI launches new developer tooling",
          summary: "A new platform update is out.",
          links: ["https://example.com/trend"],
        },
      },
    });

    const trend = {
      trendTitle: "OpenAI launches new developer tooling",
      summary: "A new platform update is out.",
      links: ["https://example.com/trend"],
      fitLabel: "Direct fit" as const,
    };

    const response = await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({ trend }),
      }),
    );

    expect(await response.json()).toEqual({ jobId: "job-1", status: "queued" });

    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(routeMocks.runIdeaWorkflow).toHaveBeenCalledWith({
      user: {
        id: "user-1",
        niche: "AI & Tech",
        tone: "clear",
        timezone: "America/Los_Angeles",
      },
      jobId: "job-1",
      log: expect.any(Function),
      input: {
        workflow: "trend",
        trend,
        mediaAssetIds: [],
        brief: undefined,
      },
    });
    expect(result).toEqual({
      ideas: [
        {
          videoTitle: "Idea 1",
          hook: "Hook 1",
          bulletOutline: ["One", "Two", "Three"],
          cta: "CTA 1",
        },
      ],
      generationMode: "multi-idea",
      contextAssessment: {
        summary: "Trend provides enough context.",
        confidence: 88,
        requiresBrief: false,
        missingContextPrompts: [],
      },
      derivedContextTrend: {
        trendTitle: "OpenAI launches new developer tooling",
        summary: "A new platform update is out.",
        links: ["https://example.com/trend"],
      },
      linkedMediaCount: 0,
      workflow: "trend",
    });
  });

  it("returns the linked asset count from the orchestrator state", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-2", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.runIdeaWorkflow.mockResolvedValue({
      selectedMediaAssets: [{ id: "asset-1", path: "/tmp/workflow-ui.png", type: "image" }],
      ideasResult: {
        ideas: [],
        generationMode: "needs-brief",
        contextAssessment: {
          summary: "Need more context.",
          confidence: 42,
          requiresBrief: true,
          missingContextPrompts: ["What is this about?"],
        },
        derivedContextTrend: {
          trendTitle: "Media-led explainer",
          summary: "Derived from uploaded media.",
          links: [],
          fitLabel: "Open feed",
          fitReason: "Derived from uploaded creator media.",
        },
      },
    });

    await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          workflow: "media-led",
          mediaAssetIds: ["asset-1"],
        }),
      }),
    );

    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(result).toEqual({
      ideas: [],
      generationMode: "needs-brief",
      contextAssessment: {
        summary: "Need more context.",
        confidence: 42,
        requiresBrief: true,
        missingContextPrompts: ["What is this about?"],
      },
      derivedContextTrend: {
        trendTitle: "Media-led explainer",
        summary: "Derived from uploaded media.",
        links: [],
        fitLabel: "Open feed",
        fitReason: "Derived from uploaded creator media.",
      },
      linkedMediaCount: 1,
      workflow: "media-led",
    });
  });
});
