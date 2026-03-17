import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  resolveUser: vi.fn(),
  runStoryboardWorkflow: vi.fn(),
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  createCreatorPilotOrchestrator: () => ({
    runStoryboardWorkflow: routeMocks.runStoryboardWorkflow,
  }),
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/storyboard/route";

describe("POST /api/storyboard", () => {
  beforeEach(() => {
    routeMocks.resolveUser.mockReset();
    routeMocks.runStoryboardWorkflow.mockReset();
  });

  it("returns 400 when the orchestrator cannot resolve any valid media", async () => {
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.runStoryboardWorkflow.mockRejectedValue(new Error("No valid media assets found for storyboarding."));

    const response = await POST(
      new Request("http://localhost/api/storyboard", {
        method: "POST",
        body: JSON.stringify({
          trend: {
            trendTitle: "OpenAI update",
            summary: "Summary",
            links: [],
          },
          idea: {
            videoTitle: "Idea",
            hook: "Hook",
            bulletOutline: [],
            cta: "CTA",
          },
          mediaAssetIds: ["asset-1"],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No valid media assets found for storyboarding." });
  });

  it("returns storyboard coverage plus the derived assessment", async () => {
    const storyboard = {
      format: "shorts",
      coverageScore: 80,
      coverageSummary: "Coverage is strong enough to render directly from the uploaded media.",
      shouldBlock: false,
      requiresMoreRelevantMedia: false,
      generatedSupportEnabled: true,
      generatedSupportUsed: true,
      assetSummaries: [],
      candidates: [],
      beats: [
        {
          beatId: "beat-1",
          order: 1,
          purpose: "hook",
          title: "Idea",
          caption: "Hook",
          narration: "Hook",
          durationSeconds: 3.2,
          visualIntent: "Strong opening visual.",
          coverageLevel: "strong",
          matchScore: 82,
          selectedCandidateId: "asset-1",
          selectedAssetId: "asset-1",
          selectedAssetPath: "/tmp/input.png",
          mediaSource: "user",
          assetType: "image",
          matchReason: "The screenshot directly matches the hook.",
          generatedVisualStatus: "not-needed",
        },
      ],
    };
    const assessment = {
      status: "relevant" as const,
      confidence: 0.8,
      summary: storyboard.coverageSummary,
      matchedSignals: ["OpenAI"],
      shouldBlock: false,
      coverageScore: 80,
      requiresGeneratedSupport: true,
    };

    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.runStoryboardWorkflow.mockResolvedValue({
      storyboard,
      assessment,
    });

    const response = await POST(
      new Request("http://localhost/api/storyboard", {
        method: "POST",
        body: JSON.stringify({
          trend: {
            trendTitle: "OpenAI update",
            summary: "Summary",
            links: [],
          },
          idea: {
            videoTitle: "Idea",
            hook: "Hook",
            bulletOutline: ["Context", "Proof"],
            cta: "CTA",
          },
          mediaAssetIds: ["asset-1"],
          preference: "shorts",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      storyboard,
      assessment,
    });
    expect(routeMocks.runStoryboardWorkflow).toHaveBeenCalledWith({
      user: {
        id: "user-1",
        niche: "AI & Tech",
        tone: "clear",
        timezone: "America/Los_Angeles",
      },
      input: {
        trend: {
          trendTitle: "OpenAI update",
          summary: "Summary",
          links: [],
        },
        idea: {
          videoTitle: "Idea",
          hook: "Hook",
          bulletOutline: ["Context", "Proof"],
          cta: "CTA",
        },
        mediaAssetIds: ["asset-1"],
        preference: "shorts",
      },
    });
  });

  it("returns JSON when an unexpected storyboard error is thrown", async () => {
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.runStoryboardWorkflow.mockRejectedValue(new Error("upstream request timeout"));

    const response = await POST(
      new Request("http://localhost/api/storyboard", {
        method: "POST",
        body: JSON.stringify({
          trend: {
            trendTitle: "OpenAI update",
            summary: "Summary",
            links: [],
          },
          idea: {
            videoTitle: "Idea",
            hook: "Hook",
            bulletOutline: [],
            cta: "CTA",
          },
          mediaAssetIds: ["asset-1"],
          preference: "shorts",
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "upstream request timeout" });
  });
});
