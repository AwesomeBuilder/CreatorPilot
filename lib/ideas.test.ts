import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Idea, Trend } from "@/lib/types";

const llmMock = vi.hoisted(() => ({
  llmChatJSON: vi.fn(),
}));

const storyboardMock = vi.hoisted(() => ({
  buildStoryboardPlan: vi.fn(),
}));

vi.mock("@/lib/llm", () => llmMock);
vi.mock("@/lib/storyboard", () => storyboardMock);

import { generateIdeas } from "@/lib/ideas";

const baseTrend: Trend = {
  trendTitle: "OpenAI agent platform update",
  summary: "Major AI tooling release for developers.",
  links: ["https://example.com/trend"],
};

function buildIdea(index: number, bulletCount = 3): Idea {
  return {
    videoTitle: `Idea ${index}`,
    hook: `Hook ${index}`,
    bulletOutline: Array.from({ length: bulletCount }, (_, bulletIndex) => `Bullet ${index}-${bulletIndex + 1}`),
    cta: `CTA ${index}`,
  };
}

describe("generateIdeas", () => {
  beforeEach(() => {
    llmMock.llmChatJSON.mockReset();
    storyboardMock.buildStoryboardPlan.mockReset();
  });

  it("falls back to bridge-style ideas when the LLM is unavailable", async () => {
    llmMock.llmChatJSON.mockResolvedValue(null);

    const result = await generateIdeas({
      trend: {
        ...baseTrend,
        fitLabel: "Adjacent angle",
      },
      niche: "AI & Tech",
      tone: "analytical",
    });

    expect(result.generationMode).toBe("multi-idea");
    expect(result.ideas).toHaveLength(3);
    expect(result.ideas[0]?.videoTitle).toContain("AI & Tech");
    expect(result.ideas[0]?.hook).toContain("AI & Tech");
    expect(result.ideas[2]?.hook).toContain("analytical");
    expect(result.derivedContextTrend).toEqual({
      ...baseTrend,
      fitLabel: "Adjacent angle",
    });
  });

  it("links uploaded media context into fallback ideas when assets are provided", async () => {
    llmMock.llmChatJSON.mockResolvedValue(null);
    storyboardMock.buildStoryboardPlan.mockRejectedValue(new Error("analysis unavailable"));

    const result = await generateIdeas({
      trend: baseTrend,
      niche: "AI & Tech",
      tone: "analytical",
      mediaAssets: [
        {
          id: "asset-1",
          path: "/tmp/creator-dashboard-demo.mp4",
          type: "video",
        },
      ],
    });

    expect(result.ideas[0]?.hook).toContain("uploaded media");
    expect(result.ideas[0]?.bulletOutline.some((bullet) => bullet.includes("creator-dashboard-demo.mp4"))).toBe(true);
  });

  it("falls back when the LLM returns too few ideas", async () => {
    llmMock.llmChatJSON.mockResolvedValue({
      ideas: [buildIdea(1), buildIdea(2)],
    });

    const result = await generateIdeas({
      trend: baseTrend,
      niche: "Creator Economy",
      tone: "direct",
    });

    expect(result.ideas).toHaveLength(3);
    expect(result.ideas[0]?.videoTitle).toContain(baseTrend.trendTitle);
  });

  it("keeps only the first three ideas and trims outlines to five bullets", async () => {
    llmMock.llmChatJSON.mockResolvedValue({
      ideas: [buildIdea(1, 6), buildIdea(2), buildIdea(3), buildIdea(4)],
    });

    const result = await generateIdeas({
      trend: baseTrend,
      niche: "AI & Tech",
      tone: "clear",
    });

    expect(result.ideas).toHaveLength(3);
    expect(result.ideas[0]?.bulletOutline).toHaveLength(5);
    expect(result.ideas[2]?.videoTitle).toBe("Idea 3");
  });

  it("passes analyzed media context into the LLM when uploads are linked", async () => {
    storyboardMock.buildStoryboardPlan.mockResolvedValue({
      format: "shorts",
      coverageScore: 74,
      coverageSummary: "Coverage is usable with the uploaded media.",
      shouldBlock: false,
      requiresMoreRelevantMedia: false,
      generatedSupportEnabled: true,
      generatedSupportUsed: false,
      recommendedUploads: ["Add one proof screenshot."],
      diagnostics: {
        multimodalEnabled: true,
        multimodalStatus: "enabled",
        multimodalFailureReasons: [],
        fallbackAssetCount: 0,
        imageGenerationEnabled: true,
        imageGenerationStatus: "enabled",
        imageGenerationFailureReasons: [],
        generatedPreviewCount: 0,
      },
      assetSummaries: [
        {
          assetId: "asset-1",
          assetPath: "/tmp/workflow-ui.png",
          type: "image",
          compactSummary: "Workflow UI screenshot.",
          bestFitScore: 81,
          topCues: ["workflow", "editor"],
          shotCount: 1,
          analysisMode: "multimodal",
        },
      ],
      candidates: [],
      beats: [
        {
          beatId: "beat-1",
          order: 1,
          purpose: "hook",
          title: "Hook",
          caption: "Hook",
          narration: "Hook",
          durationSeconds: 3.2,
          visualIntent: "A strong opening visual.",
          coverageLevel: "strong",
          matchScore: 80,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
        {
          beatId: "beat-2",
          order: 2,
          purpose: "context",
          title: "Context",
          caption: "Context",
          narration: "Context",
          durationSeconds: 3.2,
          visualIntent: "Context visual.",
          coverageLevel: "usable",
          matchScore: 70,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
        {
          beatId: "beat-3",
          order: 3,
          purpose: "proof",
          title: "Proof",
          caption: "Proof",
          narration: "Proof",
          durationSeconds: 3.2,
          visualIntent: "Proof visual.",
          coverageLevel: "usable",
          matchScore: 70,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
        {
          beatId: "beat-4",
          order: 4,
          purpose: "cta",
          title: "CTA",
          caption: "CTA",
          narration: "CTA",
          durationSeconds: 2.4,
          visualIntent: "CTA visual.",
          coverageLevel: "usable",
          matchScore: 70,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
      ],
    });
    llmMock.llmChatJSON.mockResolvedValue({
      ideas: [buildIdea(1), buildIdea(2), buildIdea(3)],
    });

    await generateIdeas({
      trend: baseTrend,
      niche: "AI & Tech",
      tone: "clear",
      mediaAssets: [
        {
          id: "asset-1",
          path: "/tmp/workflow-ui.png",
          type: "image",
        },
      ],
    });

    expect(storyboardMock.buildStoryboardPlan).toHaveBeenCalledTimes(1);
    expect(llmMock.llmChatJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('"mediaContext"'),
      }),
    );
    expect(llmMock.llmChatJSON.mock.calls[0]?.[0]?.user).toContain("Workflow UI screenshot.");
  });

  it("returns needs-brief for ambiguous media-led inputs without a written brief", async () => {
    llmMock.llmChatJSON.mockResolvedValue(null);
    storyboardMock.buildStoryboardPlan.mockRejectedValue(new Error("analysis unavailable"));

    const result = await generateIdeas({
      workflow: "media-led",
      mediaAssets: [
        {
          id: "asset-1",
          path: "/tmp/screenshot-1.png",
          type: "image",
        },
      ],
    });

    expect(result.generationMode).toBe("needs-brief");
    expect(result.ideas).toEqual([]);
    expect(result.contextAssessment.requiresBrief).toBe(true);
    expect(result.contextAssessment.missingContextPrompts).toContain("How does it work?");
    expect(result.derivedContextTrend.trendTitle).toContain("screenshot-1.png");
  });

  it("returns a single render-ready plan for media-led inputs when a brief fills the gaps", async () => {
    storyboardMock.buildStoryboardPlan.mockResolvedValue({
      format: "shorts",
      coverageScore: 76,
      coverageSummary: "The uploads already show a clear workflow and support a structured explainer.",
      shouldBlock: false,
      requiresMoreRelevantMedia: false,
      generatedSupportEnabled: true,
      generatedSupportUsed: false,
      recommendedUploads: [],
      diagnostics: {
        multimodalEnabled: true,
        multimodalStatus: "enabled",
        multimodalFailureReasons: [],
        fallbackAssetCount: 0,
        imageGenerationEnabled: true,
        imageGenerationStatus: "enabled",
        imageGenerationFailureReasons: [],
        generatedPreviewCount: 0,
      },
      assetSummaries: [
        {
          assetId: "asset-1",
          assetPath: "/tmp/workflow-ui.png",
          type: "image",
          compactSummary: "Workflow UI screenshot.",
          bestFitScore: 81,
          topCues: ["workflow", "dashboard", "creator"],
          shotCount: 1,
          analysisMode: "multimodal",
        },
      ],
      candidates: [],
      beats: [
        {
          beatId: "beat-1",
          order: 1,
          purpose: "hook",
          title: "Hook",
          caption: "Hook",
          narration: "Hook",
          durationSeconds: 3.2,
          visualIntent: "A strong opening visual.",
          coverageLevel: "strong",
          matchScore: 80,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
        {
          beatId: "beat-2",
          order: 2,
          purpose: "context",
          title: "Context",
          caption: "Context",
          narration: "Context",
          durationSeconds: 3.2,
          visualIntent: "Context visual.",
          coverageLevel: "usable",
          matchScore: 70,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
        {
          beatId: "beat-3",
          order: 3,
          purpose: "proof",
          title: "Proof",
          caption: "Proof",
          narration: "Proof",
          durationSeconds: 3.2,
          visualIntent: "Proof visual.",
          coverageLevel: "usable",
          matchScore: 70,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
        {
          beatId: "beat-4",
          order: 4,
          purpose: "cta",
          title: "CTA",
          caption: "CTA",
          narration: "CTA",
          durationSeconds: 2.4,
          visualIntent: "CTA visual.",
          coverageLevel: "usable",
          matchScore: 70,
          selectedCandidateId: null,
          selectedAssetId: null,
          selectedAssetPath: null,
          mediaSource: "none",
          assetType: "none",
          matchReason: "Coverage analysis pending.",
          generatedVisualStatus: "not-needed",
        },
      ],
    });
    llmMock.llmChatJSON.mockResolvedValue(null);

    const result = await generateIdeas({
      workflow: "media-led",
      brief: "This is a creator analytics workflow. Explain what the dashboard is, how it works, and what it unlocks next.",
      mediaAssets: [
        {
          id: "asset-1",
          path: "/tmp/workflow-ui.png",
          type: "image",
        },
      ],
    });

    expect(result.generationMode).toBe("single-plan");
    expect(result.ideas).toHaveLength(1);
    expect(result.contextAssessment.requiresBrief).toBe(false);
    expect(result.derivedContextTrend.summary).toContain("creator analytics workflow");
  });
});
