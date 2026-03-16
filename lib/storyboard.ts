import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

import { z } from "zod";

import { createGeneratedSupportingImageDetailed } from "@/lib/generated-media";
import { ensureFfmpegInstalled, FFMPEG_BIN, isImagePath, probeMedia, runBinary } from "@/lib/ffmpeg";
import { llmChatJSONWithUserContentDetailed } from "@/lib/llm";
import { generatedSupportEnabled, multimodalStoryboardAnalysisEnabled } from "@/lib/media-flags";
import type {
  BeatPurpose,
  CoverageLevel,
  Idea,
  MediaAnalysisCandidate,
  MediaRelevanceAssessment,
  MediaSourceKind,
  RenderFormat,
  RenderPreference,
  NormalizedCropWindow,
  StoryboardAssetSummary,
  StoryboardBeat,
  StoryboardSupportingVisual,
  StoryboardDiagnostics,
  StoryboardPlan,
  Trend,
} from "@/lib/types";
import { renderTestUtils } from "@/lib/render";

const MAX_ASSETS_ANALYZED = 16;
const MAX_VIDEO_SHOTS = 4;
const SUPPORTING_VISUALS_PER_BEAT = 2;
const MIN_BEATS = 4;
const MAX_BEATS = 6;

type InputAsset = {
  id: string;
  path: string;
  type: "image" | "video";
};

const CropWindowSchema = z.object({
  left: z.number().min(0).max(1),
  top: z.number().min(0).max(1),
  width: z.number().min(0.1).max(1),
  height: z.number().min(0.1).max(1),
  label: z.string().optional(),
});

const CandidateVisionRawSchema = z.object({
  visualSummary: z.string().min(1),
  compactSummary: z.string().min(1),
  ocrText: z.array(z.string()).default([]),
  uiText: z.array(z.string()).default([]),
  logos: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  topicCues: z.array(z.string()).default([]),
  fitScore: z.coerce.number().min(0).max(100),
  fitReason: z.string().min(1),
  energyScore: z.coerce.number().min(0).max(100),
  bestUseCases: z
    .array(z.enum(["hook", "context", "proof", "explanation", "takeaway", "cta"]))
    .default([]),
});

const StoryboardBeatSchema = z.object({
  beatId: z.string().min(1),
  order: z.number().int().min(1),
  purpose: z.enum(["hook", "context", "proof", "explanation", "takeaway", "cta"]),
  title: z.string().min(1),
  caption: z.string().min(1),
  narration: z.string().min(1),
  durationSeconds: z.number().positive(),
  visualIntent: z.string().min(1),
  coverageLevel: z.enum(["strong", "usable", "weak", "missing"]),
  matchScore: z.number().min(0).max(100),
  selectedCandidateId: z.string().nullable(),
  selectedAssetId: z.string().nullable(),
  selectedAssetPath: z.string().nullable(),
  mediaSource: z.enum(["user", "generated", "synthetic", "none"]),
  assetType: z.enum(["image", "video", "generated", "none"]),
  cropWindow: CropWindowSchema.optional(),
  shotStartSeconds: z.number().optional(),
  shotEndSeconds: z.number().optional(),
  matchReason: z.string().min(1),
  analysisNote: z.string().optional(),
  missingCoverageNote: z.string().optional(),
  missingCoverageGuidance: z.array(z.string()).optional(),
  generatedVisualPrompt: z.string().optional(),
  generatedVisualStatus: z.enum(["planned", "generated", "unavailable", "not-needed"]).optional(),
  generatedPreviewPath: z.string().nullable().optional(),
  supportingVisuals: z
    .array(
      z.object({
        visualId: z.string().min(1),
        assetId: z.string().nullable(),
        assetPath: z.string().nullable(),
        assetType: z.enum(["image", "video", "generated", "none"]),
        mediaSource: z.enum(["user", "generated", "synthetic", "none"]),
        label: z.string().min(1),
        cropWindow: CropWindowSchema.optional(),
        shotStartSeconds: z.number().optional(),
        shotEndSeconds: z.number().optional(),
        generatedVisualPrompt: z.string().optional(),
        generatedVisualStatus: z.enum(["planned", "generated", "unavailable", "not-needed"]).optional(),
        generatedPreviewPath: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const MediaAnalysisCandidateSchema = z.object({
  candidateId: z.string().min(1),
  assetId: z.string().nullable(),
  assetPath: z.string().min(1),
  assetType: z.enum(["image", "video", "generated"]),
  source: z.enum(["user", "generated", "synthetic"]),
  analysisMode: z.enum(["multimodal", "heuristic", "generated-preview"]).optional(),
  diagnosticMessage: z.string().optional(),
  label: z.string().min(1),
  width: z.number().optional(),
  height: z.number().optional(),
  cropWindow: CropWindowSchema.optional(),
  durationSeconds: z.number().optional(),
  frameTimeSeconds: z.number().optional(),
  shotStartSeconds: z.number().optional(),
  shotEndSeconds: z.number().optional(),
  visualSummary: z.string().min(1),
  compactSummary: z.string().min(1),
  ocrText: z.array(z.string()).default([]),
  uiText: z.array(z.string()).default([]),
  logos: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  topicCues: z.array(z.string()).default([]),
  fitScore: z.number().min(0).max(100),
  fitReason: z.string().min(1),
  energyScore: z.number().min(0).max(100),
  bestUseCases: z
    .array(z.enum(["hook", "context", "proof", "explanation", "takeaway", "cta"]))
    .default([]),
});

const StoryboardAssetSummarySchema = z.object({
  assetId: z.string().min(1),
  assetPath: z.string().min(1),
  type: z.enum(["image", "video"]),
  compactSummary: z.string().min(1),
  bestFitScore: z.number().min(0).max(100),
  topCues: z.array(z.string()).default([]),
  shotCount: z.number().int().min(1),
  analysisMode: z.enum(["multimodal", "heuristic"]).optional(),
  diagnosticMessage: z.string().optional(),
});

const StoryboardDiagnosticsSchema = z.object({
  multimodalEnabled: z.boolean(),
  multimodalStatus: z.enum(["enabled", "disabled", "partial", "failed"]),
  multimodalFailureReasons: z.array(z.string()).default([]),
  fallbackAssetCount: z.number().int().min(0),
  imageGenerationEnabled: z.boolean(),
  imageGenerationStatus: z.enum(["enabled", "disabled", "partial", "failed"]),
  imageGenerationFailureReasons: z.array(z.string()).default([]),
  generatedPreviewCount: z.number().int().min(0),
});

export const StoryboardPlanSchema = z.object({
  format: z.enum(["shorts", "landscape"]),
  coverageScore: z.number().min(0).max(100),
  coverageSummary: z.string().min(1),
  shouldBlock: z.boolean(),
  requiresMoreRelevantMedia: z.boolean(),
  generatedSupportEnabled: z.boolean(),
  generatedSupportUsed: z.boolean(),
  recommendedUploads: z.array(z.string()).optional(),
  diagnostics: StoryboardDiagnosticsSchema.optional(),
  assetSummaries: z.array(StoryboardAssetSummarySchema),
  candidates: z.array(MediaAnalysisCandidateSchema),
  beats: z.array(StoryboardBeatSchema).min(MIN_BEATS).max(MAX_BEATS),
});

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeBeatLine(value: string, maxLength: number) {
  const normalized = normalizeText(value, maxLength);
  return normalized.length > 0 ? normalized : "Visual support";
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

const GENERIC_FILENAME_TOKENS = new Set([
  "screenshot",
  "screen",
  "image",
  "photo",
  "picture",
  "jpeg",
  "jpg",
  "png",
  "heic",
  "mov",
  "mp4",
]);

function filenameSemanticTokens(assetPath: string) {
  return tokenize(path.basename(assetPath)).filter((token) => {
    if (GENERIC_FILENAME_TOKENS.has(token)) {
      return false;
    }

    if (/^\d+$/.test(token)) {
      return false;
    }

    if (/^\d{4}$/.test(token)) {
      return false;
    }

    return true;
  });
}

function overlapScore(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      matches += 1;
    }
  }

  return matches / Math.max(leftSet.size, rightSet.size);
}

function roundSeconds(value: number) {
  return Number(value.toFixed(2));
}

function secondsLabel(value?: number) {
  if (typeof value !== "number") {
    return null;
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDiagnosticMessage(message: string) {
  return normalizeText(message.replace(/^fallback analysis used because\s*/i, ""), 220);
}

function reportStoryboardDiagnostic(message: string, label: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[storyboard-analysis] ${label}: ${message}`);
  }
}

function formatForAssets(preference: RenderPreference, assets: Array<InputAsset & { probe: Awaited<ReturnType<typeof probeMedia>> }>) {
  const primary = assets[0];
  return renderTestUtils.pickFormat(preference, {
    width: primary?.probe.width,
    height: primary?.probe.height,
    duration: primary?.probe.duration,
  });
}

function cropWindowLabel(window?: NormalizedCropWindow) {
  return window?.label ? ` (${window.label})` : "";
}

function imageCropCandidates(probe: Awaited<ReturnType<typeof probeMedia>>): NormalizedCropWindow[] {
  const width = probe.width ?? 0;
  const height = probe.height ?? 0;

  if (!width || !height) {
    return [{ left: 0, top: 0, width: 1, height: 1, label: "full frame" }];
  }

  const aspect = width / height;
  const candidates: NormalizedCropWindow[] = [{ left: 0, top: 0, width: 1, height: 1, label: "full frame" }];

  if (aspect > 1.25) {
    candidates.push(
      { left: 0.1, top: 0.08, width: 0.8, height: 0.82, label: "tight center crop" },
      { left: 0.18, top: 0.12, width: 0.72, height: 0.76, label: "content crop" },
    );
  } else {
    candidates.push({ left: 0.08, top: 0.08, width: 0.84, height: 0.84, label: "tight crop" });
  }

  return candidates;
}

function summarizeZodIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function normalizeVisionCandidateResponse(data: z.infer<typeof CandidateVisionRawSchema>) {
  return {
    visualSummary: normalizeText(data.visualSummary, 280),
    compactSummary: normalizeText(data.compactSummary, 140),
    ocrText: dedupe(data.ocrText).slice(0, 8),
    uiText: dedupe(data.uiText).slice(0, 8),
    logos: dedupe(data.logos).slice(0, 6),
    entities: dedupe(data.entities).slice(0, 8),
    topicCues: dedupe(data.topicCues).slice(0, 8),
    fitScore: clamp(Math.round(data.fitScore), 0, 100),
    fitReason: normalizeText(data.fitReason, 220),
    energyScore: clamp(Math.round(data.energyScore), 0, 100),
    bestUseCases: data.bestUseCases.slice(0, 3),
  };
}

function buildBeats(params: { trend: Trend; idea: Idea; format: RenderFormat }): StoryboardBeat[] {
  const outline = params.idea.bulletOutline.filter(Boolean).slice(0, 4);
  const bodyPoints =
    outline.length > 0
      ? outline
      : [
          params.trend.summary || `What changed in ${params.trend.trendTitle}`,
          `Why ${params.trend.trendTitle} matters for creators`,
          "What to do with this trend next",
        ];

  const trimmedBody = bodyPoints.slice(0, MAX_BEATS - 2);
  while (trimmedBody.length + 2 < MIN_BEATS) {
    trimmedBody.push(`Why this matters for ${params.idea.videoTitle}`);
  }

  const durations =
    params.format === "shorts"
      ? { hook: 3.4, body: 3.1, cta: 2.4 }
      : { hook: 4.4, body: 4.1, cta: 3.2 };
  const purposes: BeatPurpose[] = ["context", "proof", "explanation", "takeaway"];

  const beats: StoryboardBeat[] = [
    {
      beatId: "beat-1",
      order: 1,
      purpose: "hook",
      title: normalizeBeatLine(params.idea.videoTitle, 72),
      caption: normalizeBeatLine(params.idea.hook, params.format === "shorts" ? 92 : 120),
      narration: normalizeBeatLine(params.idea.hook, 180),
      durationSeconds: durations.hook,
      visualIntent: `A strong opening visual that immediately grounds the audience in ${params.trend.trendTitle}.`,
      coverageLevel: "missing",
      matchScore: 0,
      selectedCandidateId: null,
      selectedAssetId: null,
      selectedAssetPath: null,
      mediaSource: "none",
      assetType: "none",
      matchReason: "Coverage analysis pending.",
      generatedVisualStatus: "not-needed",
    },
  ];

  trimmedBody.forEach((point, index) => {
    beats.push({
      beatId: `beat-${index + 2}`,
      order: index + 2,
      purpose: purposes[index] ?? "takeaway",
      title: normalizeBeatLine(point, 66),
      caption: normalizeBeatLine(point, params.format === "shorts" ? 84 : 108),
      narration: normalizeBeatLine(point, 160),
      durationSeconds: durations.body,
      visualIntent:
        index === 0
          ? `Context or proof that makes "${point}" feel concrete.`
          : `Visual support that makes "${point}" easy to understand quickly.`,
      coverageLevel: "missing",
      matchScore: 0,
      selectedCandidateId: null,
      selectedAssetId: null,
      selectedAssetPath: null,
      mediaSource: "none",
      assetType: "none",
      matchReason: "Coverage analysis pending.",
      generatedVisualStatus: "not-needed",
    });
  });

  beats.push({
    beatId: `beat-${beats.length + 1}`,
    order: beats.length + 1,
    purpose: "cta",
    title: "Close strong",
    caption: normalizeBeatLine(params.idea.cta, params.format === "shorts" ? 76 : 96),
    narration: normalizeBeatLine(params.idea.cta, 140),
    durationSeconds: durations.cta,
    visualIntent: "A clean closing frame that leaves space for the CTA and channel branding.",
    coverageLevel: "missing",
    matchScore: 0,
    selectedCandidateId: null,
    selectedAssetId: null,
    selectedAssetPath: null,
    mediaSource: "none",
    assetType: "none",
    matchReason: "Coverage analysis pending.",
    generatedVisualStatus: "not-needed",
  });

  return beats.slice(0, MAX_BEATS);
}

function shotCenters(duration?: number) {
  if (!duration || duration <= 0) {
    return [0.7];
  }

  const count = clamp(duration <= 8 ? 2 : duration <= 20 ? 3 : MAX_VIDEO_SHOTS, 2, MAX_VIDEO_SHOTS);
  const startPad = Math.min(1.25, duration / 6);
  const usable = Math.max(duration - startPad * 2, 1);

  return Array.from({ length: count }, (_, index) => roundSeconds(startPad + usable * ((index + 0.5) / count)));
}

function shotWindow(center: number, duration?: number) {
  if (!duration || duration <= 0) {
    return {
      start: 0,
      end: 2.8,
    };
  }

  const span = Math.min(3.2, Math.max(2.4, duration / 4));
  const start = clamp(center - span / 2, 0, Math.max(duration - span, 0));
  const end = clamp(start + span, start + 0.5, duration);
  return {
    start: roundSeconds(start),
    end: roundSeconds(end),
  };
}

async function createAnalysisPreview(params: {
  inputPath: string;
  outputPath: string;
  timestampSeconds?: number;
  cropWindow?: NormalizedCropWindow;
}) {
  const cropFilter = params.cropWindow
    ? `crop=iw*${params.cropWindow.width}:ih*${params.cropWindow.height}:iw*${params.cropWindow.left}:ih*${params.cropWindow.top},`
    : "";
  const outputArgs = [
    "-y",
    "-vf",
    `${cropFilter}scale='if(gt(iw,ih),960,-2)':'if(gt(iw,ih),-2,960)'`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    params.outputPath,
  ];

  if (isImagePath(params.inputPath)) {
    await runBinary(FFMPEG_BIN, ["-y", "-i", params.inputPath, ...outputArgs.slice(1)]);
    return;
  }

  await runBinary(FFMPEG_BIN, ["-y", "-ss", String(params.timestampSeconds ?? 0), "-i", params.inputPath, ...outputArgs.slice(1)]);
}

async function dataUrlForPreview(previewPath: string) {
  const bytes = await fs.readFile(previewPath);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

function fallbackCandidateAnalysis(params: {
  label: string;
  candidateId: string;
  assetId: string;
  inputPath: string;
  assetType: "image" | "video";
  cropWindow?: NormalizedCropWindow;
  diagnosticMessage?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameTimeSeconds?: number;
  shotStartSeconds?: number;
  shotEndSeconds?: number;
}): MediaAnalysisCandidate {
  const filenameTokens = filenameSemanticTokens(params.inputPath);
  const visualSummary =
    filenameTokens.length > 0
      ? `Semantic analysis was unavailable. Filename hints: ${filenameTokens.slice(0, 4).join(", ")}.`
      : "Semantic analysis was unavailable, so this asset could not be inspected visually.";
  const diagnosticMessage = params.diagnosticMessage
    ? formatDiagnosticMessage(params.diagnosticMessage)
    : "Semantic analysis was unavailable for this asset.";

  return {
    candidateId: params.candidateId,
    assetId: params.assetId,
    assetPath: params.inputPath,
    assetType: params.assetType,
    source: "user",
    analysisMode: "heuristic",
    diagnosticMessage,
    label: params.label,
    width: params.width,
    height: params.height,
    cropWindow: params.cropWindow,
    durationSeconds: params.durationSeconds,
    frameTimeSeconds: params.frameTimeSeconds,
    shotStartSeconds: params.shotStartSeconds,
    shotEndSeconds: params.shotEndSeconds,
    visualSummary,
    compactSummary: normalizeText(visualSummary, 100),
    ocrText: [],
    uiText: [],
    logos: [],
    entities: [],
    topicCues: filenameTokens.slice(0, 4),
    fitScore: filenameTokens.length > 0 ? 34 : 18,
    fitReason: diagnosticMessage,
    energyScore: params.assetType === "video" ? 60 : 45,
    bestUseCases: params.assetType === "video" ? ["hook", "proof"] : ["context", "explanation"],
  };
}

async function analyzePreviewWithVision(params: {
  trend: Trend;
  idea: Idea;
  inputPath: string;
  label: string;
  candidateId: string;
  assetId: string;
  assetType: "image" | "video";
  cropWindow?: NormalizedCropWindow;
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameTimeSeconds?: number;
  shotStartSeconds?: number;
  shotEndSeconds?: number;
  previewPath: string;
}) {
  if (!multimodalStoryboardAnalysisEnabled()) {
    reportStoryboardDiagnostic(
      "Multimodal storyboard analysis is disabled by ENABLE_MULTIMODAL_STORYBOARD_ANALYSIS.",
      params.label,
    );
    return fallbackCandidateAnalysis({
      ...params,
      diagnosticMessage: "Multimodal storyboard analysis is disabled by ENABLE_MULTIMODAL_STORYBOARD_ANALYSIS.",
    });
  }

  try {
    const response = await llmChatJSONWithUserContentDetailed<z.infer<typeof CandidateVisionRawSchema>>({
      system:
        "You analyze creator-uploaded media for a storyboard-driven explainer. Extract only visually supported signals, keep OCR literal when possible, and score how well the visual matches the supplied trend and video idea.",
      userContent: [
        {
          type: "text",
          text: JSON.stringify({
            task: "Analyze one uploaded image or sampled video frame for storyboard coverage.",
            trend: {
              trendTitle: params.trend.trendTitle,
              summary: params.trend.summary,
            },
            idea: params.idea,
            assetLabel: params.label,
            outputSchema: {
              visualSummary: "string",
              compactSummary: "string",
              ocrText: ["string"],
              uiText: ["string"],
              logos: ["string"],
              entities: ["string"],
              topicCues: ["string"],
              fitScore: "integer 0..100",
              fitReason: "string",
              energyScore: "integer 0..100",
              bestUseCases: ["hook | context | proof | explanation | takeaway | cta"],
            },
          }),
        },
        {
          type: "image_url",
          image_url: {
            url: await dataUrlForPreview(params.previewPath),
          },
        },
      ],
      temperature: 0.2,
    });

    const parsed = CandidateVisionRawSchema.safeParse(response.data);
    if (!parsed.success) {
      const issueSummary = response.data
        ? `Model ${response.modelUsed ?? "unknown"} returned JSON that could not be normalized: ${summarizeZodIssues(parsed.error)}`
        : response.responsePreview
          ? `${response.error ?? "The multimodal model returned an unexpected response."} Response preview: ${response.responsePreview}`
          : response.error ?? "The multimodal model returned an unexpected response.";
      reportStoryboardDiagnostic(issueSummary, params.label);
      return fallbackCandidateAnalysis({
        ...params,
        diagnosticMessage: issueSummary,
      });
    }

    const normalized = normalizeVisionCandidateResponse(parsed.data);

    return {
      candidateId: params.candidateId,
      assetId: params.assetId,
      assetPath: params.inputPath,
      assetType: params.assetType,
      source: "user" as MediaSourceKind,
      analysisMode: "multimodal" as const,
      label: params.label,
      width: params.width,
      height: params.height,
      cropWindow: params.cropWindow,
      durationSeconds: params.durationSeconds,
      frameTimeSeconds: params.frameTimeSeconds,
      shotStartSeconds: params.shotStartSeconds,
      shotEndSeconds: params.shotEndSeconds,
      visualSummary: normalized.visualSummary,
      compactSummary: normalized.compactSummary,
      ocrText: normalized.ocrText,
      uiText: normalized.uiText,
      logos: normalized.logos,
      entities: normalized.entities,
      topicCues: normalized.topicCues,
      fitScore: normalized.fitScore,
      fitReason: normalized.fitReason,
      energyScore: normalized.energyScore,
      bestUseCases: normalized.bestUseCases.length > 0 ? normalized.bestUseCases : ["context"],
    } satisfies MediaAnalysisCandidate;
  } catch (error) {
    reportStoryboardDiagnostic(error instanceof Error ? error.message : "Multimodal request failed.", params.label);
    return fallbackCandidateAnalysis({
      ...params,
      diagnosticMessage:
        error instanceof Error ? `Multimodal request failed: ${error.message}` : "Multimodal request failed for this asset.",
    });
  }
}

async function analyzeAssetCandidates(params: {
  trend: Trend;
  idea: Idea;
  asset: InputAsset;
  tempDir: string;
}): Promise<MediaAnalysisCandidate[]> {
  const probe = await probeMedia(params.asset.path);

  if (params.asset.type === "image") {
    const cropCandidates = imageCropCandidates(probe);
    const candidates: MediaAnalysisCandidate[] = [];

    for (let index = 0; index < cropCandidates.length; index += 1) {
      const cropWindow = cropCandidates[index];
      const previewPath = path.join(params.tempDir, `${params.asset.id}-crop-${index + 1}.jpg`);
      await createAnalysisPreview({
        inputPath: params.asset.path,
        outputPath: previewPath,
        cropWindow,
      });

      candidates.push(
        await analyzePreviewWithVision({
          trend: params.trend,
          idea: params.idea,
          inputPath: params.asset.path,
          label: `${path.basename(params.asset.path)}${cropWindowLabel(cropWindow)}`,
          candidateId: `${params.asset.id}:crop-${index + 1}`,
          assetId: params.asset.id,
          assetType: "image",
          width: probe.width,
          height: probe.height,
          cropWindow,
          previewPath,
        }),
      );
    }

    return candidates;
  }

  const centers = shotCenters(probe.duration);
  const candidates: MediaAnalysisCandidate[] = [];

  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index] ?? 0;
    const window = shotWindow(center, probe.duration);
    const previewPath = path.join(params.tempDir, `${params.asset.id}-shot-${index + 1}.jpg`);
    await createAnalysisPreview({
      inputPath: params.asset.path,
      outputPath: previewPath,
      timestampSeconds: center,
    });

    candidates.push(
      await analyzePreviewWithVision({
        trend: params.trend,
        idea: params.idea,
        inputPath: params.asset.path,
        label: `${path.basename(params.asset.path)} @ ${secondsLabel(center) ?? "0:00"}`,
        candidateId: `${params.asset.id}:shot-${index + 1}`,
        assetId: params.asset.id,
        assetType: "video",
        width: probe.width,
        height: probe.height,
        durationSeconds: probe.duration,
        frameTimeSeconds: center,
        shotStartSeconds: window.start,
        shotEndSeconds: window.end,
        previewPath,
      }),
    );
  }

  return candidates;
}

function summarizeAsset(asset: InputAsset, candidates: MediaAnalysisCandidate[]): StoryboardAssetSummary {
  const sorted = [...candidates].sort((left, right) => right.fitScore - left.fitScore);
  const best = sorted[0];
  const allHeuristic = sorted.length > 0 && sorted.every((candidate) => candidate.analysisMode === "heuristic");
  return {
    assetId: asset.id,
    assetPath: asset.path,
    type: asset.type,
    compactSummary:
      best?.analysisMode === "heuristic"
        ? best.diagnosticMessage ?? "Semantic analysis was unavailable for this asset."
        : best?.compactSummary ?? `Uploaded ${asset.type}.`,
    bestFitScore: best?.fitScore ?? 0,
    topCues: dedupe(
      sorted.flatMap((candidate) => [...candidate.topicCues, ...candidate.logos, ...candidate.entities, ...candidate.ocrText]),
    ).slice(0, 5),
    shotCount: Math.max(1, candidates.length),
    analysisMode: allHeuristic ? "heuristic" : "multimodal",
    diagnosticMessage: best?.analysisMode === "heuristic" ? best.diagnosticMessage : undefined,
  };
}

function beatCoverageLevel(score: number): CoverageLevel {
  if (score >= 70) return "strong";
  if (score >= 55) return "usable";
  if (score >= 40) return "weak";
  return "missing";
}

function generatedPrompt(params: { trend: Trend; idea: Idea; beat: StoryboardBeat; format: RenderFormat }) {
  return normalizeText(
    `Create a clean, high-clarity supporting still for a YouTube ${params.format} explainer about ${params.trend.trendTitle}. Focus on: ${params.beat.visualIntent}. Beat title: ${params.beat.title}. Keep it editorial and modern, avoid overlaid text, watermarks, device frames, extra UI chrome, or unrelated people.`,
    420,
  );
}

function candidateTokens(candidate: MediaAnalysisCandidate) {
  return tokenize(
    [
      candidate.visualSummary,
      candidate.compactSummary,
      ...candidate.ocrText,
      ...candidate.uiText,
      ...candidate.logos,
      ...candidate.entities,
      ...candidate.topicCues,
    ].join(" "),
  );
}

function beatTokens(beat: StoryboardBeat, trend: Trend, idea: Idea) {
  return tokenize([beat.title, beat.caption, beat.visualIntent, trend.trendTitle, trend.summary, idea.videoTitle].join(" "));
}

function scoreCandidateForBeat(params: {
  beat: StoryboardBeat;
  candidate: MediaAnalysisCandidate;
  trend: Trend;
  idea: Idea;
}) {
  const overlap = overlapScore(beatTokens(params.beat, params.trend, params.idea), candidateTokens(params.candidate));
  const useCaseBonus = params.candidate.bestUseCases.includes(params.beat.purpose) ? 12 : 0;
  const hookBonus =
    params.beat.purpose === "hook" ? Math.round((params.candidate.energyScore / 100) * 14) : params.beat.purpose === "cta" ? 4 : 0;
  const videoBonus = params.beat.purpose === "hook" && params.candidate.assetType === "video" ? 6 : 0;

  return clamp(Math.round(params.candidate.fitScore * 0.62 + overlap * 30 + useCaseBonus + hookBonus + videoBonus), 0, 100);
}

function bestAvailableCandidateNote(candidate: MediaAnalysisCandidate | null) {
  if (!candidate) {
    return "No uploaded media matched this beat strongly enough.";
  }

  const timecode =
    typeof candidate.shotStartSeconds === "number" && typeof candidate.shotEndSeconds === "number"
      ? ` (${secondsLabel(candidate.shotStartSeconds)}-${secondsLabel(candidate.shotEndSeconds)})`
      : "";
  return `Best uploaded option: ${candidate.label}${timecode}. ${candidate.fitReason}`;
}

function supportingVisualFromCandidate(candidate: MediaAnalysisCandidate): StoryboardSupportingVisual {
  return {
    visualId: `${candidate.candidateId}:support`,
    assetId: candidate.assetId,
    assetPath: candidate.assetPath,
    assetType: candidate.assetType,
    mediaSource: candidate.source,
    label: candidate.label,
    cropWindow: candidate.cropWindow,
    shotStartSeconds: candidate.shotStartSeconds,
    shotEndSeconds: candidate.shotEndSeconds,
    generatedVisualStatus: "not-needed",
    generatedPreviewPath: null,
  };
}

function generatedSupportingVisual(params: { beat: StoryboardBeat; trend: Trend; idea: Idea; format: RenderFormat }): StoryboardSupportingVisual {
  return {
    visualId: `${params.beat.beatId}:generated-support`,
    assetId: null,
    assetPath: null,
    assetType: "generated",
    mediaSource: "generated",
    label: `${params.beat.title} generated support`,
    generatedVisualPrompt: generatedPrompt({
      trend: params.trend,
      idea: params.idea,
      beat: params.beat,
      format: params.format,
    }),
    generatedVisualStatus: "planned",
    generatedPreviewPath: null,
  };
}

function missingCoverageGuidance(params: { beat: StoryboardBeat; trend: Trend; idea: Idea }) {
  const beatLabel = params.beat.title || params.idea.videoTitle;

  switch (params.beat.purpose) {
    case "hook":
      return [
        `Upload a headline, hero image, or primary UI screenshot that clearly shows ${params.trend.trendTitle}.`,
        `Add a short demo clip or product shot that immediately establishes "${params.idea.videoTitle}".`,
      ];
    case "context":
      return [
        `Add a context screenshot or article frame that visually explains "${beatLabel}".`,
        `Prefer visuals with readable labels, UI text, or a clear subject tied to ${params.trend.trendTitle}.`,
      ];
    case "proof":
      return [
        `Upload proof visuals for "${beatLabel}": analytics, charts, before/after states, quotes, or feature results.`,
        `A tighter clip or screenshot with visible evidence will score better than generic desktop captures.`,
      ];
    case "explanation":
      return [
        `Add a walkthrough visual that makes "${beatLabel}" understandable at a glance.`,
        `Product UI, diagrams, or annotated screenshots work better here than broad scene-setting images.`,
      ];
    case "takeaway":
      return [
        `Upload a concluding visual that reinforces the takeaway in "${beatLabel}".`,
        `A summary chart, final UI state, or outcome screenshot is better than another generic overview shot.`,
      ];
    case "cta":
      return [
        "A clean branded end card is enough here.",
      ];
  }
}

function weakCoverageReason(params: {
  beat: StoryboardBeat;
  bestCandidate: MediaAnalysisCandidate | null;
  bestScore: number;
}) {
  if (!params.bestCandidate) {
    return `No uploaded asset clearly shows the visual proof needed for "${params.beat.title}".`;
  }

  if (params.bestCandidate.analysisMode === "heuristic") {
    return `The best available asset for "${params.beat.title}" could not be inspected semantically, so it was only ranked heuristically from the filename.`;
  }

  if ((params.bestCandidate.ocrText.length + params.bestCandidate.uiText.length + params.bestCandidate.logos.length) === 0) {
    return `The selected asset is too generic for "${params.beat.title}" because it lacks readable UI text, logos, or clear on-screen evidence.`;
  }

  if (params.bestScore < 40) {
    return `The selected asset does not clearly show the subject needed for "${params.beat.title}".`;
  }

  return `The selected asset is only a partial match for "${params.beat.title}" and needs stronger visual evidence.`;
}

function finalizeBeats(params: {
  trend: Trend;
  idea: Idea;
  format: RenderFormat;
  beats: StoryboardBeat[];
  candidates: MediaAnalysisCandidate[];
}) {
  const generationEnabled = generatedSupportEnabled();
  const nonCtaScores: number[] = [];
  const assetUsage = new Map<string, number>();

  const beats = params.beats.map((beat) => {
    const ranked = [...params.candidates]
      .map((candidate) => ({
        candidate,
        score:
          scoreCandidateForBeat({
            beat,
            candidate,
            trend: params.trend,
            idea: params.idea,
          }) - (candidate.assetId ? (assetUsage.get(candidate.assetId) ?? 0) * 12 : 0),
      }))
      .sort((left, right) => right.score - left.score);

    const best = ranked[0]?.candidate ?? null;
    const bestScore = ranked[0]?.score ?? 0;
    const coverageLevel = beatCoverageLevel(bestScore);
    if (beat.purpose !== "cta") {
      nonCtaScores.push(bestScore);
    }

    if (best?.assetId) {
      assetUsage.set(best.assetId, (assetUsage.get(best.assetId) ?? 0) + 1);
    }

    const supportingVisuals = ranked
      .filter(({ candidate, score }) => {
        if (!best) return false;
        if (candidate.candidateId === best.candidateId) return false;
        if (candidate.assetPath === best.assetPath && candidate.cropWindow?.label === best.cropWindow?.label) return false;
        if (best.assetId && candidate.assetId && candidate.assetId === best.assetId) return false;
        return score >= 44;
      })
      .map(({ candidate }) => supportingVisualFromCandidate(candidate))
      .filter((visual, index, all) => all.findIndex((candidate) => candidate.assetPath === visual.assetPath) === index)
      .slice(0, SUPPORTING_VISUALS_PER_BEAT);

    const shouldGenerate = beat.purpose !== "cta" && bestScore < 55 && generationEnabled;
    const shouldUseSyntheticCta = beat.purpose === "cta" && bestScore < 50;
    const shouldEnrichWithGeneratedSupport =
      generationEnabled &&
      beat.purpose !== "cta" &&
      !shouldGenerate &&
      supportingVisuals.length < 1 &&
      coverageLevel !== "strong" &&
      (best?.assetType === "image" || !best);
    const guidance = bestScore < 70 ? missingCoverageGuidance({ beat, trend: params.trend, idea: params.idea }) : undefined;
    const analysisNote = best?.analysisMode === "heuristic" ? best.diagnosticMessage : undefined;

    if (shouldGenerate) {
      return {
        ...beat,
        coverageLevel,
        matchScore: bestScore,
        mediaSource: "generated" as const,
        assetType: "generated" as const,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        cropWindow: undefined,
        matchReason: weakCoverageReason({
          beat,
          bestCandidate: best,
          bestScore,
        }),
        analysisNote,
        missingCoverageNote: bestAvailableCandidateNote(best),
        missingCoverageGuidance: guidance,
        generatedVisualPrompt: generatedPrompt({
          trend: params.trend,
          idea: params.idea,
          beat,
          format: params.format,
        }),
        generatedVisualStatus: "planned" as const,
        generatedPreviewPath: null,
        supportingVisuals: best ? [supportingVisualFromCandidate(best)] : [],
      };
    }

    if (shouldUseSyntheticCta) {
      return {
        ...beat,
        coverageLevel,
        matchScore: bestScore,
        mediaSource: "synthetic" as const,
        assetType: "none" as const,
        selectedCandidateId: null,
        selectedAssetId: null,
        selectedAssetPath: null,
        cropWindow: undefined,
        matchReason: weakCoverageReason({
          beat,
          bestCandidate: best,
          bestScore,
        }),
        analysisNote,
        missingCoverageNote: bestAvailableCandidateNote(best),
        missingCoverageGuidance: guidance,
        generatedVisualStatus: "not-needed" as const,
        generatedPreviewPath: null,
        supportingVisuals: [],
      };
    }

    const enrichedSupportingVisuals = shouldEnrichWithGeneratedSupport
      ? [...supportingVisuals, generatedSupportingVisual({ beat, trend: params.trend, idea: params.idea, format: params.format })]
      : supportingVisuals;

    return {
      ...beat,
      coverageLevel,
      matchScore: bestScore,
      mediaSource: best ? ("user" as const) : ("none" as const),
      assetType: best?.assetType ?? "none",
      selectedCandidateId: best?.candidateId ?? null,
      selectedAssetId: best?.assetId ?? null,
      selectedAssetPath: best?.assetPath ?? null,
      cropWindow: best?.cropWindow,
      shotStartSeconds: best?.shotStartSeconds,
      shotEndSeconds: best?.shotEndSeconds,
      matchReason:
        best && coverageLevel !== "weak" && coverageLevel !== "missing"
          ? `${best.label} matches this beat because ${best.fitReason}`
          : weakCoverageReason({
              beat,
              bestCandidate: best,
              bestScore,
            }),
      analysisNote,
      missingCoverageNote: coverageLevel === "weak" || coverageLevel === "missing" ? bestAvailableCandidateNote(best) : undefined,
      missingCoverageGuidance: coverageLevel === "weak" || coverageLevel === "missing" ? guidance : undefined,
      generatedVisualStatus: (
        generationEnabled
          ? shouldEnrichWithGeneratedSupport
            ? "planned"
            : "not-needed"
          : coverageLevel === "weak" || coverageLevel === "missing"
            ? "unavailable"
            : "not-needed"
      ) as StoryboardBeat["generatedVisualStatus"],
      generatedPreviewPath: null,
      supportingVisuals: enrichedSupportingVisuals,
    };
  });

  const usableNonCta = beats.filter((beat) => beat.purpose !== "cta" && beat.matchScore >= 55).length;
  const supportedNonCta = beats.filter((beat) => {
    if (beat.purpose === "cta") {
      return false;
    }

    if (beat.matchScore >= 55 || beat.mediaSource === "generated") {
      return true;
    }

    return (beat.supportingVisuals ?? []).some((visual) => visual.mediaSource === "generated");
  }).length;
  const averageNonCta = nonCtaScores.length > 0 ? nonCtaScores.reduce((sum, score) => sum + score, 0) / nonCtaScores.length : 0;
  const generatedCount = beats.reduce((count, beat) => {
    const supportingGeneratedCount = (beat.supportingVisuals ?? []).filter((visual) => visual.mediaSource === "generated").length;
    return count + (beat.mediaSource === "generated" ? 1 : 0) + supportingGeneratedCount;
  }, 0);
  const coverageScore = Math.round(
    beats.reduce((sum, beat) => {
      if (beat.mediaSource === "generated") return sum + 62;
      if (beat.mediaSource === "synthetic") return sum + 58;
      return sum + beat.matchScore;
    }, 0) / beats.length,
  );
  const shouldBlock = params.candidates.length === 0 || Math.max(usableNonCta, supportedNonCta) < 2 || averageNonCta < 42;

  let coverageSummary = "";
  if (shouldBlock) {
    coverageSummary = "Coverage is too weak to produce a coherent explainer. Upload more topic-specific screenshots or clips before rendering.";
  } else if (generatedCount > 0) {
    coverageSummary = `Coverage is usable, but ${generatedCount} generated support visual${generatedCount === 1 ? "" : "s"} will fill visual gaps.`;
  } else {
    coverageSummary = "Coverage is strong enough to render directly from the uploaded media.";
  }

  return {
    beats,
    coverageScore: clamp(coverageScore, 0, 100),
    coverageSummary,
    shouldBlock,
    requiresMoreRelevantMedia: shouldBlock,
    generatedSupportUsed: generatedCount > 0,
    generatedSupportEnabled: generationEnabled,
  };
}

function recommendedUploadsFromBeats(beats: StoryboardBeat[]) {
  return dedupe(
    beats
      .filter((beat) => beat.coverageLevel === "weak" || beat.coverageLevel === "missing")
      .flatMap((beat) => beat.missingCoverageGuidance ?? []),
  ).slice(0, 6);
}

function buildStoryboardDiagnostics(params: {
  candidates: MediaAnalysisCandidate[];
  generatedPreviewCount?: number;
  generatedPreviewFailureReasons?: string[];
}): StoryboardDiagnostics {
  const fallbackAssetCount = params.candidates.filter((candidate) => candidate.analysisMode === "heuristic").length;
  const multimodalEnabled = multimodalStoryboardAnalysisEnabled();
  const multimodalFailureReasons = dedupe(
    params.candidates
      .filter((candidate) => candidate.analysisMode === "heuristic")
      .map((candidate) => candidate.diagnosticMessage ?? "Semantic analysis was unavailable."),
  ).slice(0, 6);
  const multimodalStatus = !multimodalEnabled
    ? "disabled"
    : fallbackAssetCount === 0
      ? "enabled"
      : fallbackAssetCount === params.candidates.length
        ? "failed"
        : "partial";
  const imageGenerationEnabled = generatedSupportEnabled();
  const imageGenerationFailureReasons = dedupe(params.generatedPreviewFailureReasons ?? []).slice(0, 6);
  const imageGenerationStatus = !imageGenerationEnabled
    ? "disabled"
    : imageGenerationFailureReasons.length === 0
      ? "enabled"
      : params.generatedPreviewCount && params.generatedPreviewCount > 0
        ? "partial"
        : "failed";

  return {
    multimodalEnabled,
    multimodalStatus,
    multimodalFailureReasons,
    fallbackAssetCount,
    imageGenerationEnabled,
    imageGenerationStatus,
    imageGenerationFailureReasons,
    generatedPreviewCount: params.generatedPreviewCount ?? 0,
  };
}

export async function buildStoryboardPlan(params: {
  trend: Trend;
  idea: Idea;
  assets: InputAsset[];
  preference?: RenderPreference;
}): Promise<StoryboardPlan> {
  if (params.assets.length === 0) {
    return {
      format: "shorts",
      coverageScore: 0,
      coverageSummary: "No uploaded media is available yet.",
      shouldBlock: true,
      requiresMoreRelevantMedia: true,
      generatedSupportEnabled: generatedSupportEnabled(),
      generatedSupportUsed: false,
      recommendedUploads: [],
      diagnostics: buildStoryboardDiagnostics({
        candidates: [],
      }),
      assetSummaries: [],
      candidates: [],
      beats: buildBeats({
        trend: params.trend,
        idea: params.idea,
        format: "shorts",
      }),
    };
  }

  await ensureFfmpegInstalled();

  const assets = params.assets.slice(0, MAX_ASSETS_ANALYZED);
  const assetsWithProbe = await Promise.all(
    assets.map(async (asset) => ({
      ...asset,
      probe: await probeMedia(asset.path),
    })),
  );
  const pickedFormat = formatForAssets(params.preference ?? "auto", assetsWithProbe);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "creator-pilot-storyboard-"));

  try {
    const candidateGroups = await Promise.all(
      assets.map((asset) =>
        analyzeAssetCandidates({
          trend: params.trend,
          idea: params.idea,
          asset,
          tempDir,
        }),
      ),
    );

    const candidates = candidateGroups.flat();
    const beats = buildBeats({
      trend: params.trend,
      idea: params.idea,
      format: pickedFormat.format,
    });

    const finalized = finalizeBeats({
      trend: params.trend,
      idea: params.idea,
      format: pickedFormat.format,
      beats,
      candidates,
    });

    return StoryboardPlanSchema.parse({
      format: pickedFormat.format,
      coverageScore: finalized.coverageScore,
      coverageSummary: finalized.coverageSummary,
      shouldBlock: finalized.shouldBlock,
      requiresMoreRelevantMedia: finalized.requiresMoreRelevantMedia,
      generatedSupportEnabled: finalized.generatedSupportEnabled,
      generatedSupportUsed: finalized.generatedSupportUsed,
      recommendedUploads: recommendedUploadsFromBeats(finalized.beats),
      diagnostics: buildStoryboardDiagnostics({
        candidates,
      }),
      assetSummaries: assets.map((asset, index) => summarizeAsset(asset, candidateGroups[index] ?? [])),
      candidates,
      beats: finalized.beats,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function hydrateStoryboardGeneratedPreviews(params: {
  userId: string;
  scopeId: string;
  storyboard: StoryboardPlan;
}) {
  const failureReasons: string[] = [];
  let generatedPreviewCount = 0;

  const beats = [] as StoryboardBeat[];
  for (const beat of params.storyboard.beats) {
    let hydratedBeat = beat;

    if (beat.mediaSource === "generated" && beat.generatedVisualPrompt) {
      if (beat.generatedPreviewPath && existsSync(beat.generatedPreviewPath)) {
        generatedPreviewCount += 1;
      } else {
        const previewResult = await createGeneratedSupportingImageDetailed({
          userId: params.userId,
          scopeId: params.scopeId,
          beatId: beat.beatId,
          prompt: beat.generatedVisualPrompt,
          format: params.storyboard.format,
          scope: "storyboard-preview",
        });

        if (previewResult.path) {
          generatedPreviewCount += 1;
          hydratedBeat = {
            ...hydratedBeat,
            generatedPreviewPath: previewResult.path,
            selectedAssetPath: previewResult.path,
            assetType: "generated",
          };
        } else {
          const failureReason = previewResult.error ?? `Preview generation failed for "${beat.title}".`;
          failureReasons.push(failureReason);
          reportStoryboardDiagnostic(failureReason, beat.beatId);
          hydratedBeat = {
            ...hydratedBeat,
            generatedPreviewPath: null,
            generatedVisualStatus: "unavailable",
            analysisNote: failureReason,
          };
        }
      }
    }

    const supportingVisuals: StoryboardSupportingVisual[] = [];
    for (const visual of hydratedBeat.supportingVisuals ?? []) {
      if (visual.mediaSource !== "generated" || !visual.generatedVisualPrompt) {
        supportingVisuals.push(visual);
        continue;
      }

      if (visual.generatedPreviewPath && existsSync(visual.generatedPreviewPath)) {
        generatedPreviewCount += 1;
        supportingVisuals.push(visual);
        continue;
      }

      const previewResult = await createGeneratedSupportingImageDetailed({
        userId: params.userId,
        scopeId: params.scopeId,
        beatId: visual.visualId,
        prompt: visual.generatedVisualPrompt,
        format: params.storyboard.format,
        scope: "storyboard-preview",
      });

      if (previewResult.path) {
        generatedPreviewCount += 1;
        supportingVisuals.push({
          ...visual,
          assetPath: previewResult.path,
          generatedPreviewPath: previewResult.path,
          generatedVisualStatus: "generated",
        });
        continue;
      }

      const failureReason = previewResult.error ?? `Preview generation failed for "${visual.label}".`;
      failureReasons.push(failureReason);
      reportStoryboardDiagnostic(failureReason, visual.visualId);
      supportingVisuals.push({
        ...visual,
        generatedPreviewPath: null,
        generatedVisualStatus: "unavailable",
      });
    }

    beats.push({
      ...hydratedBeat,
      supportingVisuals,
    });
  }

  return StoryboardPlanSchema.parse({
    ...params.storyboard,
    beats,
    diagnostics: buildStoryboardDiagnostics({
      candidates: params.storyboard.candidates,
      generatedPreviewCount,
      generatedPreviewFailureReasons: failureReasons,
    }),
  });
}

export function storyboardPlanToAssessment(plan: StoryboardPlan): MediaRelevanceAssessment {
  const status = plan.shouldBlock ? "irrelevant" : plan.coverageScore >= 72 ? "relevant" : "unclear";
  const matchedSignals = dedupe(
    plan.candidates.flatMap((candidate) => [...candidate.logos, ...candidate.entities, ...candidate.topicCues, ...candidate.ocrText]),
  ).slice(0, 5);

  return {
    status,
    confidence: Number((plan.coverageScore / 100).toFixed(2)),
    summary: plan.coverageSummary,
    matchedSignals,
    shouldBlock: plan.shouldBlock,
    coverageScore: plan.coverageScore,
    requiresGeneratedSupport: plan.generatedSupportUsed,
  };
}

export const storyboardTestUtils = {
  beatCoverageLevel,
  buildBeats,
  finalizeBeats,
  generatedPrompt,
  scoreCandidateForBeat,
  tokenize,
};
