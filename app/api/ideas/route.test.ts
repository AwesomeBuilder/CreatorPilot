import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      findMany: vi.fn(),
    },
  },
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  generateIdeas: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/jobs", () => ({
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/ideas", () => ({
  generateIdeas: routeMocks.generateIdeas,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/ideas/route";

describe("POST /api/ideas", () => {
  beforeEach(() => {
    routeMocks.prisma.mediaAsset.findMany.mockReset();
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.generateIdeas.mockReset();
    routeMocks.resolveUser.mockReset();
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

  it("queues idea generation and passes the selected trend plus user preferences into the task", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
    });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.generateIdeas.mockResolvedValue({
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
    expect(backgroundTask).toBeTypeOf("function");

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(routeMocks.generateIdeas).toHaveBeenCalledWith({
      workflow: "trend",
      trend,
      niche: "AI & Tech",
      tone: "clear",
      mediaAssets: [],
    });
    expect(log).toHaveBeenCalledWith("Generating three ideas from selected trend.");
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

  it("loads linked media assets and returns the linked asset count in the job output", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-2", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
    });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        path: "/tmp/workflow-ui.png",
        type: "image",
      },
    ]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.generateIdeas.mockResolvedValue({
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
        summary: "Uploads support the trend angle.",
        confidence: 79,
        requiresBrief: false,
        missingContextPrompts: [],
      },
      derivedContextTrend: {
        trendTitle: "OpenAI launches new developer tooling",
        summary: "A new platform update is out.",
        links: ["https://example.com/trend"],
      },
    });

    await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          trend: {
            trendTitle: "OpenAI launches new developer tooling",
            summary: "A new platform update is out.",
            links: ["https://example.com/trend"],
          },
          mediaAssetIds: ["asset-1"],
        }),
      }),
    );

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(routeMocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          {
            id: {
              in: ["asset-1"],
            },
          },
          {
            path: {
              in: ["asset-1"],
            },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    expect(routeMocks.generateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaAssets: [
          {
            id: "asset-1",
            path: "/tmp/workflow-ui.png",
            type: "image",
          },
        ],
      }),
    );
    expect(log).toHaveBeenCalledWith("Linked 1 uploaded media asset into idea generation.");
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
        summary: "Uploads support the trend angle.",
        confidence: 79,
        requiresBrief: false,
        missingContextPrompts: [],
      },
      derivedContextTrend: {
        trendTitle: "OpenAI launches new developer tooling",
        summary: "A new platform update is out.",
        links: ["https://example.com/trend"],
      },
      linkedMediaCount: 1,
      workflow: "trend",
    });
  });

  it("supports media-led workflow and returns a single render-ready angle", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-3", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "Creator Economy",
      tone: "direct",
    });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        path: "/tmp/workflow-ui.png",
        type: "image",
      },
    ]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.generateIdeas.mockResolvedValue({
      ideas: [
        {
          videoTitle: "One focused plan",
          hook: "Explain what the audience is looking at.",
          bulletOutline: ["Hook", "Walkthrough", "Future direction"],
          cta: "Comment for the next breakdown.",
        },
      ],
      generationMode: "single-plan",
      contextAssessment: {
        summary: "The upload already implies a clear walkthrough.",
        confidence: 84,
        requiresBrief: false,
        missingContextPrompts: [],
      },
      derivedContextTrend: {
        trendTitle: "Workflow explainer",
        summary: "Creator dashboard walkthrough.",
        links: [],
        fitLabel: "Open feed",
        fitReason: "Derived from uploaded creator media and optional text context.",
      },
    });

    await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          workflow: "media-led",
          mediaAssetIds: ["asset-1"],
          brief: "Explain what this dashboard does.",
        }),
      }),
    );

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(routeMocks.generateIdeas).toHaveBeenCalledWith({
      workflow: "media-led",
      brief: "Explain what this dashboard does.",
      niche: "Creator Economy",
      tone: "direct",
      mediaAssets: [
        {
          id: "asset-1",
          path: "/tmp/workflow-ui.png",
          type: "image",
        },
      ],
    });
    expect(log).toHaveBeenCalledWith("Assessing uploaded media and optional brief for media-led idea generation.");
    expect(log).toHaveBeenCalledWith("Generated one render-ready angle from the uploaded media context.");
    expect(result).toEqual({
      ideas: [
        {
          videoTitle: "One focused plan",
          hook: "Explain what the audience is looking at.",
          bulletOutline: ["Hook", "Walkthrough", "Future direction"],
          cta: "Comment for the next breakdown.",
        },
      ],
      generationMode: "single-plan",
      contextAssessment: {
        summary: "The upload already implies a clear walkthrough.",
        confidence: 84,
        requiresBrief: false,
        missingContextPrompts: [],
      },
      derivedContextTrend: {
        trendTitle: "Workflow explainer",
        summary: "Creator dashboard walkthrough.",
        links: [],
        fitLabel: "Open feed",
        fitReason: "Derived from uploaded creator media and optional text context.",
      },
      linkedMediaCount: 1,
      workflow: "media-led",
    });
  });

  it("returns needs-brief job output for ambiguous media-led requests", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-4", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "Creator Economy",
      tone: "direct",
    });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        path: "/tmp/screenshot-1.png",
        type: "image",
      },
    ]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.generateIdeas.mockResolvedValue({
      ideas: [],
      generationMode: "needs-brief",
      contextAssessment: {
        summary: "The screenshot does not explain enough on its own.",
        confidence: 34,
        requiresBrief: true,
        missingContextPrompts: ["What is this about?", "How does it work?"],
      },
      derivedContextTrend: {
        trendTitle: "Explainer from screenshot-1.png",
        summary: "Need more context.",
        links: [],
        fitLabel: "Open feed",
        fitReason: "Derived from uploaded creator media and optional text context.",
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

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(log).toHaveBeenCalledWith("Need more text context before a confident media-led angle can be generated.");
    expect(result).toEqual({
      ideas: [],
      generationMode: "needs-brief",
      contextAssessment: {
        summary: "The screenshot does not explain enough on its own.",
        confidence: 34,
        requiresBrief: true,
        missingContextPrompts: ["What is this about?", "How does it work?"],
      },
      derivedContextTrend: {
        trendTitle: "Explainer from screenshot-1.png",
        summary: "Need more context.",
        links: [],
        fitLabel: "Open feed",
        fitReason: "Derived from uploaded creator media and optional text context.",
      },
      linkedMediaCount: 1,
      workflow: "media-led",
    });
  });

  it("resolves linked media by stored path for backward compatibility", async () => {
    const assetPath = "/app/uploads/user-1/manual-123/workflow-ui.png";
    routeMocks.createJob.mockResolvedValue({ id: "job-5", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "Creator Economy",
      tone: "direct",
    });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        path: assetPath,
        type: "image",
      },
    ]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.generateIdeas.mockResolvedValue({
      ideas: [
        {
          videoTitle: "One focused plan",
          hook: "Explain the dashboard flow.",
          bulletOutline: ["Hook", "Walkthrough", "CTA"],
          cta: "Comment for the next breakdown.",
        },
      ],
      generationMode: "single-plan",
      contextAssessment: {
        summary: "The upload already implies a clear walkthrough.",
        confidence: 84,
        requiresBrief: false,
        missingContextPrompts: [],
      },
      derivedContextTrend: {
        trendTitle: "Workflow explainer",
        summary: "Creator dashboard walkthrough.",
        links: [],
        fitLabel: "Open feed",
        fitReason: "Derived from uploaded creator media and optional text context.",
      },
    });

    await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          workflow: "media-led",
          mediaAssetIds: [assetPath],
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
    expect(routeMocks.generateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaAssets: [
          {
            id: "asset-1",
            path: assetPath,
            type: "image",
          },
        ],
      }),
    );
  });
});
