import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { storyboardPlanToAssessment, storyboardTestUtils } from "@/lib/storyboard";
import type { Idea, MediaAnalysisCandidate, Trend } from "@/lib/types";

const trend: Trend = {
  trendTitle: "Creator workflow update",
  summary: "A new editor and analytics workflow is rolling out.",
  links: ["https://example.com/story"],
};

const idea: Idea = {
  videoTitle: "What this workflow update changes",
  hook: "This update changes how fast you can ship content.",
  bulletOutline: ["New editor launch", "Revenue analytics angle"],
  cta: "Follow for more creator tooling breakdowns.",
};

describe("storyboard helpers", () => {
  const originalGeneratedSupport = process.env.ENABLE_GENERATED_SUPPORT_MEDIA;
  const originalGeneratedSupportMode = process.env.GENERATED_SUPPORT_MEDIA_MODE;

  beforeEach(() => {
    delete process.env.ENABLE_GENERATED_SUPPORT_MEDIA;
    delete process.env.GENERATED_SUPPORT_MEDIA_MODE;
  });

  afterEach(() => {
    if (originalGeneratedSupport === undefined) {
      delete process.env.ENABLE_GENERATED_SUPPORT_MEDIA;
    } else {
      process.env.ENABLE_GENERATED_SUPPORT_MEDIA = originalGeneratedSupport;
    }

    if (originalGeneratedSupportMode === undefined) {
      delete process.env.GENERATED_SUPPORT_MEDIA_MODE;
    } else {
      process.env.GENERATED_SUPPORT_MEDIA_MODE = originalGeneratedSupportMode;
    }
  });

  it("builds a normalized 4-6 beat structure with hook and CTA anchors", () => {
    const beats = storyboardTestUtils.buildBeats({
      trend,
      idea,
      format: "shorts",
    });

    expect(beats).toHaveLength(4);
    expect(beats[0]?.purpose).toBe("hook");
    expect(beats.at(-1)?.purpose).toBe("cta");
  });

  it("plans generated supporting visuals for weak beats when generation is enabled", () => {
    process.env.ENABLE_GENERATED_SUPPORT_MEDIA = "true";
    process.env.GENERATED_SUPPORT_MEDIA_MODE = "video";

    const beats = storyboardTestUtils.buildBeats({
      trend,
      idea,
      format: "shorts",
    });

    const candidates: MediaAnalysisCandidate[] = [
      {
        candidateId: "asset-1:shot-1",
        assetId: "asset-1",
        assetPath: "/tmp/workflow.mp4",
        assetType: "video",
        source: "user",
        label: "workflow shot",
        durationSeconds: 9,
        frameTimeSeconds: 2.4,
        shotStartSeconds: 1.2,
        shotEndSeconds: 4.2,
        visualSummary: "Editor workflow UI with creator timeline.",
        compactSummary: "Workflow editor UI.",
        ocrText: ["Editor", "Timeline"],
        uiText: ["Creator studio"],
        logos: [],
        entities: ["Creator Pilot"],
        topicCues: ["workflow", "editor", "creator"],
        fitScore: 70,
        fitReason: "The clip clearly shows the new editing workflow.",
        energyScore: 72,
        bestUseCases: ["hook", "context"],
      },
      {
        candidateId: "asset-2",
        assetId: "asset-2",
        assetPath: "/tmp/unrelated.png",
        assetType: "image",
        source: "user",
        label: "generic image",
        visualSummary: "Abstract unrelated visual.",
        compactSummary: "Generic visual.",
        ocrText: [],
        uiText: [],
        logos: [],
        entities: [],
        topicCues: ["generic"],
        fitScore: 24,
        fitReason: "It does not show the product or analytics angle.",
        energyScore: 20,
        bestUseCases: ["cta"],
      },
    ];

    const finalized = storyboardTestUtils.finalizeBeats({
      trend,
      idea,
      format: "shorts",
      beats,
      candidates,
    });

    expect(finalized.shouldBlock).toBe(false);
    expect(finalized.generatedSupportUsed).toBe(true);
    expect(finalized.beats.some((beat) => beat.mediaSource === "generated")).toBe(true);
    expect(finalized.beats.find((beat) => beat.mediaSource === "generated")?.generatedVisualPrompt).toContain("Creator workflow update");
    expect(finalized.beats.find((beat) => beat.mediaSource === "generated")?.generatedAssetPlan?.requestedKind).toBe("motion");
    expect(finalized.beats.find((beat) => beat.mediaSource === "generated")?.missingCoverageGuidance?.length).toBeGreaterThan(0);
  });

  it("blocks rendering when there is not enough usable non-CTA coverage", () => {
    const beats = storyboardTestUtils.buildBeats({
      trend,
      idea,
      format: "shorts",
    });

    const candidates: MediaAnalysisCandidate[] = [
      {
        candidateId: "asset-1",
        assetId: "asset-1",
        assetPath: "/tmp/generic.png",
        assetType: "image",
        source: "user",
        label: "generic upload",
        visualSummary: "A generic stock-like background.",
        compactSummary: "Generic background.",
        ocrText: [],
        uiText: [],
        logos: [],
        entities: [],
        topicCues: ["generic"],
        fitScore: 28,
        fitReason: "It is only loosely related to the selected topic.",
        energyScore: 22,
        bestUseCases: ["cta"],
      },
    ];

    const finalized = storyboardTestUtils.finalizeBeats({
      trend,
      idea,
      format: "shorts",
      beats,
      candidates,
    });

    expect(finalized.shouldBlock).toBe(true);
    expect(finalized.requiresMoreRelevantMedia).toBe(true);
    expect(finalized.coverageSummary).toContain("Coverage is too weak");
    expect(finalized.beats.some((beat) => (beat.missingCoverageGuidance?.length ?? 0) > 0)).toBe(true);
  });

  it("preserves the selected crop window for matched uploaded image beats", () => {
    const beats = storyboardTestUtils.buildBeats({
      trend,
      idea,
      format: "landscape",
    });

    const candidates: MediaAnalysisCandidate[] = [
      {
        candidateId: "asset-1:crop-2",
        assetId: "asset-1",
        assetPath: "/tmp/screenshot.png",
        assetType: "image",
        source: "user",
        label: "screenshot (content crop)",
        cropWindow: {
          left: 0.18,
          top: 0.12,
          width: 0.72,
          height: 0.76,
          label: "content crop",
        },
        visualSummary: "Cropped product UI showing the analytics panel.",
        compactSummary: "Analytics panel crop.",
        ocrText: ["Analytics", "Revenue"],
        uiText: ["Creator studio"],
        logos: [],
        entities: ["Creator Pilot"],
        topicCues: ["analytics", "workflow", "creator"],
        fitScore: 74,
        fitReason: "The crop isolates the relevant analytics proof.",
        energyScore: 44,
        bestUseCases: ["proof", "explanation"],
      },
    ];

    const finalized = storyboardTestUtils.finalizeBeats({
      trend,
      idea,
      format: "landscape",
      beats,
      candidates,
    });

    const matchedImageBeat = finalized.beats.find((beat) => beat.mediaSource === "user" && beat.assetType === "image");
    expect(matchedImageBeat?.cropWindow).toEqual({
      left: 0.18,
      top: 0.12,
      width: 0.72,
      height: 0.76,
      label: "content crop",
    });
  });

  it("maps storyboard coverage into a media relevance assessment", () => {
    const assessment = storyboardPlanToAssessment({
      format: "shorts",
      coverageScore: 76,
      coverageSummary: "Coverage is usable, but 1 beat will use generated support to fill visual gaps.",
      shouldBlock: false,
      requiresMoreRelevantMedia: false,
      generatedSupportEnabled: true,
      generatedSupportUsed: true,
      assetSummaries: [],
      candidates: [
        {
          candidateId: "asset-1",
          assetId: "asset-1",
          assetPath: "/tmp/workflow.mp4",
          assetType: "video",
          source: "user",
          label: "workflow shot",
          visualSummary: "Workflow UI",
          compactSummary: "Workflow UI",
          ocrText: ["Workflow"],
          uiText: [],
          logos: ["OpenAI"],
          entities: [],
          topicCues: ["creator"],
          fitScore: 76,
          fitReason: "Strong match.",
          energyScore: 60,
          bestUseCases: ["hook"],
        },
      ],
      beats: [],
    });

    expect(assessment).toEqual({
      status: "relevant",
      confidence: 0.76,
      summary: "Coverage is usable, but 1 beat will use generated support to fill visual gaps.",
      matchedSignals: ["OpenAI", "creator", "Workflow"],
      shouldBlock: false,
      coverageScore: 76,
      requiresGeneratedSupport: true,
    });
  });
});
