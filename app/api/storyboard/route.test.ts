import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    mediaAsset: {
      findMany: vi.fn(),
    },
  },
  buildStoryboardPlan: vi.fn(),
  hydrateStoryboardGeneratedPreviews: vi.fn(),
  storyboardPlanToAssessment: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/storyboard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storyboard")>("@/lib/storyboard");
  return {
    ...actual,
    buildStoryboardPlan: routeMocks.buildStoryboardPlan,
    hydrateStoryboardGeneratedPreviews: routeMocks.hydrateStoryboardGeneratedPreviews,
    storyboardPlanToAssessment: routeMocks.storyboardPlanToAssessment,
  };
});

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/storyboard/route";

describe("POST /api/storyboard", () => {
  beforeEach(() => {
    routeMocks.prisma.mediaAsset.findMany.mockReset();
    routeMocks.buildStoryboardPlan.mockReset();
    routeMocks.hydrateStoryboardGeneratedPreviews.mockReset();
    routeMocks.storyboardPlanToAssessment.mockReset();
    routeMocks.resolveUser.mockReset();
  });

  it("returns 400 when no valid media assets are found", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([]);

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
        {
          beatId: "beat-2",
          order: 2,
          purpose: "context",
          title: "Context",
          caption: "Context",
          narration: "Context",
          durationSeconds: 3,
          visualIntent: "Context visual.",
          coverageLevel: "usable",
          matchScore: 70,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "generated",
          assetType: "generated",
          matchReason: "Generated support will cover the missing context.",
          generatedVisualPrompt: "Create a clean supporting still.",
          generatedVisualStatus: "planned",
        },
        {
          beatId: "beat-3",
          order: 3,
          purpose: "proof",
          title: "Proof",
          caption: "Proof",
          narration: "Proof",
          durationSeconds: 3,
          visualIntent: "Proof visual.",
          coverageLevel: "usable",
          matchScore: 68,
          selectedCandidateId: "asset-1",
          selectedAssetId: "asset-1",
          selectedAssetPath: "/tmp/input.png",
          mediaSource: "user",
          assetType: "image",
          matchReason: "Same screenshot supports the proof.",
          generatedVisualStatus: "not-needed",
        },
        {
          beatId: "beat-4",
          order: 4,
          purpose: "cta",
          title: "Close strong",
          caption: "CTA",
          narration: "CTA",
          durationSeconds: 2.2,
          visualIntent: "Clean close.",
          coverageLevel: "usable",
          matchScore: 60,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "synthetic",
          assetType: "none",
          matchReason: "A fallback card closes more cleanly.",
          generatedVisualStatus: "not-needed",
        },
      ],
    };

    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.mediaAsset.findMany.mockResolvedValue([{ id: "asset-1", path: "/tmp/input.png", type: "image" }]);
    routeMocks.buildStoryboardPlan.mockResolvedValue(storyboard);
    routeMocks.hydrateStoryboardGeneratedPreviews.mockResolvedValue(storyboard);
    routeMocks.storyboardPlanToAssessment.mockReturnValue({
      status: "relevant",
      confidence: 0.8,
      summary: storyboard.coverageSummary,
      matchedSignals: ["OpenAI"],
      shouldBlock: false,
      coverageScore: 80,
      requiresGeneratedSupport: true,
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
      assessment: {
        status: "relevant",
        confidence: 0.8,
        summary: storyboard.coverageSummary,
        matchedSignals: ["OpenAI"],
        shouldBlock: false,
        coverageScore: 80,
        requiresGeneratedSupport: true,
      },
    });
    expect(routeMocks.buildStoryboardPlan).toHaveBeenCalledWith({
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
      assets: [{ id: "asset-1", path: "/tmp/input.png", type: "image" }],
      preference: "shorts",
    });
    expect(routeMocks.hydrateStoryboardGeneratedPreviews).toHaveBeenCalledWith({
      userId: "user-1",
      scopeId: expect.stringMatching(/^storyboard-/),
      storyboard,
    });
  });
});
