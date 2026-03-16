import { describe, expect, it } from "vitest";

import { applyStoryboardEditorialTiming } from "@/lib/editorial";
import type { StoryboardPlan } from "@/lib/types";

function makeStoryboard(): StoryboardPlan {
  return {
    format: "shorts",
    coverageScore: 82,
    coverageSummary: "Coverage is strong enough to render directly from the uploaded media.",
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
        title: "This creator workflow changes fast.",
        caption: "A sharper hook",
        narration: "This creator workflow changes fast, and the first update is the subtitle engine.",
        durationSeconds: 3.4,
        visualIntent: "Open on the creator workflow.",
        coverageLevel: "strong",
        matchScore: 80,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        mediaSource: "synthetic",
        assetType: "none",
        matchReason: "A fallback frame is enough for the test.",
        generatedVisualStatus: "not-needed",
      },
      {
        beatId: "beat-2",
        order: 2,
        purpose: "proof",
        title: "The subtitles now track narration.",
        caption: "Timed lower subtitles",
        narration: "The second beat proves the captions are chunked and timed against the narration pacing.",
        durationSeconds: 3.1,
        visualIntent: "Show subtitle proof.",
        coverageLevel: "usable",
        matchScore: 72,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        mediaSource: "synthetic",
        assetType: "none",
        matchReason: "A fallback frame is enough for the test.",
        generatedVisualStatus: "not-needed",
      },
    ],
  };
}

describe("editorial timing helpers", () => {
  it("adds beat windows, title overlays, and timed subtitle cues", () => {
    const storyboard = applyStoryboardEditorialTiming(makeStoryboard());

    expect(storyboard.durationSeconds).toBe(6.5);
    expect(storyboard.beats[0]?.timelineStartSeconds).toBe(0);
    expect(storyboard.beats[0]?.timelineEndSeconds).toBe(3.4);
    expect(storyboard.beats[1]?.timelineStartSeconds).toBe(3.4);
    expect(storyboard.beats[1]?.timelineEndSeconds).toBe(6.5);
    expect(storyboard.beats[0]?.titleOverlay?.label).toBe("HOOK");
    expect(storyboard.beats[0]?.subtitleCues?.length).toBeGreaterThan(0);
    expect(storyboard.subtitleCues?.length).toBeGreaterThanOrEqual(2);

    const firstCue = storyboard.beats[0]?.subtitleCues?.[0];
    expect(firstCue?.startSeconds).toBeGreaterThanOrEqual(0.1);
    expect(firstCue?.endSeconds).toBeLessThanOrEqual(3.3);
    expect(firstCue?.text.length).toBeGreaterThan(5);
  });
});
