import { afterEach, describe, expect, it } from "vitest";

import { buildNarrationTrack } from "@/lib/narration";
import type { StoryboardPlan } from "@/lib/types";

function makeStoryboard(): StoryboardPlan {
  return {
    format: "landscape",
    coverageScore: 80,
    coverageSummary: "Coverage is strong enough to render.",
    shouldBlock: false,
    requiresMoreRelevantMedia: false,
    generatedSupportEnabled: true,
    generatedSupportUsed: false,
    assetSummaries: [],
    candidates: [],
    beats: [
      {
        beatId: "beat-1",
        order: 1,
        purpose: "hook",
        title: "Hook",
        caption: "Hook caption",
        narration: "Hook narration",
        durationSeconds: 4.4,
        visualIntent: "Lead visual",
        coverageLevel: "usable",
        matchScore: 80,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        mediaSource: "synthetic",
        assetType: "none",
        matchReason: "Synthetic test beat.",
      },
      {
        beatId: "beat-2",
        order: 2,
        purpose: "context",
        title: "Context",
        caption: "Context caption",
        narration: "Context narration",
        durationSeconds: 4.1,
        visualIntent: "Context visual",
        coverageLevel: "usable",
        matchScore: 78,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        mediaSource: "synthetic",
        assetType: "none",
        matchReason: "Synthetic test beat.",
      },
      {
        beatId: "beat-3",
        order: 3,
        purpose: "proof",
        title: "Proof",
        caption: "Proof caption",
        narration: "Proof narration",
        durationSeconds: 4.1,
        visualIntent: "Proof visual",
        coverageLevel: "usable",
        matchScore: 76,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        mediaSource: "synthetic",
        assetType: "none",
        matchReason: "Synthetic test beat.",
      },
      {
        beatId: "beat-4",
        order: 4,
        purpose: "cta",
        title: "CTA",
        caption: "CTA caption",
        narration: "CTA narration",
        durationSeconds: 3.2,
        visualIntent: "Closing visual",
        coverageLevel: "usable",
        matchScore: 70,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        mediaSource: "synthetic",
        assetType: "none",
        matchReason: "Synthetic test beat.",
      },
    ],
  };
}

describe("buildNarrationTrack", () => {
  afterEach(() => {
    delete process.env.RENDER_ENABLE_GENERATED_NARRATION;
  });

  it("skips narration generation when disabled", async () => {
    process.env.RENDER_ENABLE_GENERATED_NARRATION = "false";

    const result = await buildNarrationTrack({
      userId: "user-1",
      jobId: "job-1",
      storyboard: makeStoryboard(),
    });

    expect(result.path).toBeNull();
    expect(result.narrationPath).toBeNull();
    expect(result.error).toBe("Generated narration is disabled by RENDER_ENABLE_GENERATED_NARRATION.");
    expect(result.audioComposition.narration.status).toBe("disabled");
    expect(result.audioComposition.backgroundMusic.status).toBe("disabled");
    expect(result.audioComposition.transitionSfx.status).toBe("disabled");
  });
});
