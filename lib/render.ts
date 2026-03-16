import { promises as fs } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";

import {
  createGeneratedSupportingAssetDetailed,
} from "@/lib/generated-media";
import { ensureDir, ensureFfmpegInstalled, FFMPEG_BIN, isImagePath, probeMedia, runBinary } from "@/lib/ffmpeg";
import { applyStoryboardEditorialTiming, compactOverlayCopy, sanitizeOverlayText, wrapOverlayText } from "@/lib/editorial";
import { buildNarrationTrack } from "@/lib/narration";
import type {
  NormalizedCropWindow,
  RenderFormat,
  RenderOutput,
  RenderPreference,
  StoryboardBeat,
  StoryboardPlan,
  StoryboardSupportingVisual,
} from "@/lib/types";

const FADE_DURATION = 0.18;
const SUBTITLE_FADE_DURATION = 0.1;
const DEFAULT_FRAME_RATE = 30;
const DISPLAY_FONT_CANDIDATES = [
  "/System/Library/Fonts/Avenir.ttc",
  "/System/Library/Fonts/Avenir Next.ttc",
  "/System/Library/Fonts/Supplemental/Futura.ttc",
  "/System/Library/Fonts/Supplemental/GillSans.ttc",
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];
const BODY_FONT_CANDIDATES = [
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

const VARIANT_STYLES = [
  {
    accentColor: "0xF97316",
    titleChip: "0x111827",
    syntheticBackground: "0x0F172A",
    panelStroke: "0xFED7AA",
    transition: "smoothleft",
    panSpeed: 0.42,
    driftX: 0.1,
    driftY: 0.07,
  },
  {
    accentColor: "0x10B981",
    titleChip: "0x052E2B",
    syntheticBackground: "0x062C2C",
    panelStroke: "0xA7F3D0",
    transition: "fadeblack",
    panSpeed: 0.54,
    driftX: 0.08,
    driftY: 0.06,
  },
  {
    accentColor: "0x2563EB",
    titleChip: "0x172554",
    syntheticBackground: "0x0F1C3C",
    panelStroke: "0xBFDBFE",
    transition: "smoothup",
    panSpeed: 0.48,
    driftX: 0.09,
    driftY: 0.05,
  },
];

type LayoutPreset = {
  width: number;
  height: number;
  titleX: number;
  titleY: number;
  titleBoxW: number;
  titleBoxH: number;
  titleFontSize: number;
  titleLineLength: number;
  titleDuration: number;
  labelFontSize: number;
  titleLabelYOffset: number;
  titleTextYOffset: number;
  subtitleX: number;
  subtitleY: number;
  subtitleBoxW: number;
  subtitleBoxH: number;
  subtitleFontSize: number;
  subtitleLineLength: number;
  subtitleMaxLines: number;
  subtitleLineSpacing: number;
  imageInset: number;
};

function resolveFontFile(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const DISPLAY_FONT_FILE = resolveFontFile(DISPLAY_FONT_CANDIDATES);
const BODY_FONT_FILE = resolveFontFile(BODY_FONT_CANDIDATES);

function requireFontFile(fontPath: string | null, role: "display" | "body") {
  if (fontPath) {
    return fontPath;
  }

  const candidates = role === "display" ? DISPLAY_FONT_CANDIDATES : BODY_FONT_CANDIDATES;
  throw new Error(`Render ${role} font file is unavailable. Install one of: ${candidates.join(", ")}`);
}

function ensureRenderFontsAvailable() {
  requireFontFile(DISPLAY_FONT_FILE, "display");
  requireFontFile(BODY_FONT_FILE, "body");
}

function drawtextFontOption(fontPath: string | null, role: "display" | "body") {
  return `:fontfile='${escapeFilterValue(requireFontFile(fontPath, role))}'`;
}

function escapeFilterValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

type BeatVisualSource = {
  assetPath: string;
  assetType: StoryboardBeat["assetType"];
  cropWindow?: NormalizedCropWindow;
  shotStartSeconds?: number;
  shotEndSeconds?: number;
};

function beatVisualSources(beat: StoryboardBeat): BeatVisualSource[] {
  const visuals: BeatVisualSource[] = [];

  if (beat.selectedAssetPath) {
    visuals.push({
      assetPath: beat.selectedAssetPath,
      assetType: beat.assetType,
      cropWindow: beat.cropWindow,
      shotStartSeconds: beat.shotStartSeconds,
      shotEndSeconds: beat.shotEndSeconds,
    });
  }

  for (const visual of beat.supportingVisuals ?? []) {
    if (!visual.assetPath) {
      continue;
    }

    visuals.push({
      assetPath: visual.assetPath,
      assetType: visual.assetType,
      cropWindow: visual.cropWindow,
      shotStartSeconds: visual.shotStartSeconds,
      shotEndSeconds: visual.shotEndSeconds,
    });
  }

  return visuals.filter(
    (visual, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.assetPath === visual.assetPath &&
          candidate.shotStartSeconds === visual.shotStartSeconds &&
          candidate.shotEndSeconds === visual.shotEndSeconds &&
          candidate.cropWindow?.label === visual.cropWindow?.label,
      ) === index,
  );
}

function splitBeatDuration(totalSeconds: number, segmentCount: number) {
  if (segmentCount <= 1) {
    return [Number(totalSeconds.toFixed(2))];
  }

  const weights =
    segmentCount === 2 ? [0.58, 0.42] : segmentCount === 3 ? [0.44, 0.32, 0.24] : Array.from({ length: segmentCount }, () => 1 / segmentCount);

  const durations = weights.map((weight) => Number((totalSeconds * weight).toFixed(2)));
  const assigned = durations.reduce((sum, value) => sum + value, 0);
  durations[durations.length - 1] = Number((durations[durations.length - 1]! + (totalSeconds - assigned)).toFixed(2));
  return durations;
}

async function withOverlayTextFile<T>(params: { basePath: string; suffix: string; text: string }, run: (textFilePath: string) => Promise<T>) {
  const textFilePath = `${params.basePath}.${params.suffix}.txt`;
  await fs.writeFile(textFilePath, params.text, "utf8");

  try {
    return await run(textFilePath);
  } finally {
    await fs.unlink(textFilePath).catch(() => undefined);
  }
}

function pickFormat(preference: RenderPreference, probe: { width?: number; height?: number; duration?: number }) {
  if (preference === "shorts") {
    return {
      format: "shorts" as const,
      reason: "User preference set to Shorts (1080x1920).",
    };
  }

  if (preference === "landscape") {
    return {
      format: "landscape" as const,
      reason: "User preference set to landscape (1920x1080).",
    };
  }

  if (probe.height && probe.width && probe.height > probe.width) {
    return {
      format: "shorts" as const,
      reason: "Auto-selected Shorts because source media is portrait.",
    };
  }

  if (probe.duration && probe.duration > 1 && probe.duration <= 75) {
    return {
      format: "shorts" as const,
      reason: "Auto-selected Shorts because source media duration is short.",
    };
  }

  return {
    format: "landscape" as const,
    reason: "Auto-selected landscape for longer or horizontal source media.",
  };
}

function resolutionForFormat(format: RenderFormat) {
  if (format === "shorts") {
    return { width: 1080, height: 1920 };
  }

  return { width: 1920, height: 1080 };
}

function layoutForFormat(format: RenderFormat): LayoutPreset {
  if (format === "shorts") {
    return {
      width: 1080,
      height: 1920,
      titleX: 68,
      titleY: 80,
      titleBoxW: 760,
      titleBoxH: 116,
      titleFontSize: 36,
      titleLineLength: 26,
      titleDuration: 1.05,
      labelFontSize: 22,
      titleLabelYOffset: 18,
      titleTextYOffset: 46,
      subtitleX: 74,
      subtitleY: 1478,
      subtitleBoxW: 932,
      subtitleBoxH: 214,
      subtitleFontSize: 40,
      subtitleLineLength: 24,
      subtitleMaxLines: 3,
      subtitleLineSpacing: 12,
      imageInset: 108,
    };
  }

  return {
    width: 1920,
    height: 1080,
    titleX: 96,
    titleY: 64,
    titleBoxW: 980,
    titleBoxH: 102,
    titleFontSize: 40,
    titleLineLength: 34,
    titleDuration: 1.12,
    labelFontSize: 20,
    titleLabelYOffset: 16,
    titleTextYOffset: 42,
    subtitleX: 188,
    subtitleY: 796,
    subtitleBoxW: 1544,
    subtitleBoxH: 144,
    subtitleFontSize: 36,
    subtitleLineLength: 42,
    subtitleMaxLines: 2,
    subtitleLineSpacing: 10,
    imageInset: 148,
  };
}

async function concatClips(clips: string[], outputPath: string) {
  const concatPath = `${outputPath}.txt`;
  const content = clips.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join("\n");

  await fs.writeFile(concatPath, content, "utf8");

  try {
    await runBinary(FFMPEG_BIN, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    await fs.unlink(concatPath).catch(() => undefined);
  }
}

async function muxAudioTrack(params: {
  videoPath: string;
  audioPath: string;
  outputPath: string;
}) {
  await runBinary(FFMPEG_BIN, [
    "-y",
    "-i",
    params.videoPath,
    "-i",
    params.audioPath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-shortest",
    params.outputPath,
  ]);
}

function beatLabel(beat: StoryboardBeat) {
  return beat.purpose.toUpperCase();
}

function cropFilterPrefix(cropWindow?: NormalizedCropWindow) {
  if (!cropWindow) {
    return null;
  }

  return `crop=iw*${cropWindow.width}:ih*${cropWindow.height}:iw*${cropWindow.left}:ih*${cropWindow.top}`;
}

function sequenceTransitionOverlap(totalSeconds: number, segmentCount: number) {
  if (segmentCount <= 1) {
    return 0;
  }

  return Number(Math.min(0.24, totalSeconds / (segmentCount * 5.5)).toFixed(2));
}

function driftExpression(axis: "x" | "y", style: (typeof VARIANT_STYLES)[number], phase: number) {
  if (axis === "x") {
    return `((in_w-out_w)*${style.driftX.toFixed(3)})*sin(t*${style.panSpeed}+${phase.toFixed(2)})`;
  }

  return `((in_h-out_h)*${style.driftY.toFixed(3)})*cos(t*${Math.max(0.28, style.panSpeed * 0.82).toFixed(3)}+${phase.toFixed(2)})`;
}

function editorialSurfaceFilters(layout: LayoutPreset, style: (typeof VARIANT_STYLES)[number]) {
  return [
    `drawbox=x=0:y=0:w=${layout.width}:h=${Math.round(layout.height * 0.2)}:color=black@0.08:t=fill`,
    `drawbox=x=0:y=${Math.round(layout.height * 0.72)}:w=${layout.width}:h=${Math.round(layout.height * 0.28)}:color=black@0.18:t=fill`,
    `drawbox=x=0:y=0:w=${layout.width}:h=3:color=${style.accentColor}@0.86:t=fill`,
  ].join(",");
}

function subtitleBoxY(layout: LayoutPreset, lineCount: number) {
  const textBlockHeight = lineCount * layout.subtitleFontSize + Math.max(0, lineCount - 1) * layout.subtitleLineSpacing;
  return Math.round(layout.subtitleY + (layout.subtitleBoxH - textBlockHeight) / 2);
}

function buildBeatIntroFilter(params: {
  layout: LayoutPreset;
  beat: StoryboardBeat;
  style: (typeof VARIANT_STYLES)[number];
  titleFilePath: string;
  labelFilePath: string;
}) {
  const titleDuration = params.beat.titleOverlay?.endOffsetSeconds ?? params.layout.titleDuration;
  return [
    editorialSurfaceFilters(params.layout, params.style),
    `drawbox=x=${params.layout.titleX}:y=${params.layout.titleY}:w=${params.layout.titleBoxW}:h=${params.layout.titleBoxH}:color=${params.style.titleChip}@0.78:t=fill:enable='between(t,0,${titleDuration})'`,
    `drawbox=x=${params.layout.titleX + 20}:y=${params.layout.titleY + 16}:w=6:h=${params.layout.titleBoxH - 32}:color=${params.style.accentColor}@1:t=fill:enable='between(t,0,${titleDuration})'`,
    `drawtext=textfile='${escapeFilterValue(params.labelFilePath)}':expansion=none${drawtextFontOption(DISPLAY_FONT_FILE, "display")}:fontcolor=${params.style.panelStroke}:fontsize=${params.layout.labelFontSize}:x=${params.layout.titleX + 40}:y=${params.layout.titleY + params.layout.titleLabelYOffset}:fix_bounds=1:enable='between(t,0,${titleDuration})'`,
    `drawtext=textfile='${escapeFilterValue(params.titleFilePath)}':expansion=none${drawtextFontOption(DISPLAY_FONT_FILE, "display")}:fontcolor=white:fontsize=${params.layout.titleFontSize}:x=${params.layout.titleX + 40}:y=${params.layout.titleY + params.layout.titleTextYOffset}:line_spacing=8:fix_bounds=1:enable='between(t,0,${titleDuration})'`,
    `fade=t=in:st=0:d=${FADE_DURATION}`,
    `fade=t=out:st=${Math.max(0.1, params.beat.durationSeconds - FADE_DURATION)}:d=${FADE_DURATION}`,
  ].join(",");
}

async function createSyntheticClip(params: {
  outputPath: string;
  layout: LayoutPreset;
  beat: StoryboardBeat;
  style: (typeof VARIANT_STYLES)[number];
}) {
  const titleText = wrapOverlayText(params.beat.titleOverlay?.text ?? params.beat.title, params.layout.titleLineLength, 2);
  const statementText = wrapOverlayText(
    compactOverlayCopy(params.beat.caption || params.beat.narration || params.beat.title, params.layout.subtitleLineLength * 2),
    params.layout.subtitleLineLength,
    Math.min(2, params.layout.subtitleMaxLines),
  );
  const labelText = beatLabel(params.beat);

  await withOverlayTextFile({ basePath: params.outputPath, suffix: "title", text: titleText }, async (titleFilePath) =>
    withOverlayTextFile({ basePath: params.outputPath, suffix: "statement", text: statementText }, async (statementFilePath) =>
      withOverlayTextFile({ basePath: params.outputPath, suffix: "label", text: labelText }, async (labelFilePath) => {
        const filter = [
          `drawbox=x=0:y=0:w=${params.layout.width}:h=${params.layout.height}:color=${params.style.syntheticBackground}@1:t=fill`,
          `drawbox=x=${Math.round(params.layout.width * 0.08)}:y=${Math.round(params.layout.height * 0.18)}:w=${Math.round(params.layout.width * 0.84)}:h=${Math.round(params.layout.height * 0.5)}:color=black@0.18:t=fill`,
          `drawbox=x=${Math.round(params.layout.width * 0.08)}:y=${Math.round(params.layout.height * 0.18)}:w=8:h=${Math.round(params.layout.height * 0.5)}:color=${params.style.accentColor}@1:t=fill`,
          buildBeatIntroFilter({
            layout: params.layout,
            beat: params.beat,
            style: params.style,
            titleFilePath,
            labelFilePath,
          }),
          `drawtext=textfile='${escapeFilterValue(statementFilePath)}':expansion=none${drawtextFontOption(DISPLAY_FONT_FILE, "display")}:fontcolor=white:fontsize=${Math.round(params.layout.subtitleFontSize * 1.02)}:x=${Math.round(params.layout.width * 0.14)}:y=${Math.round(params.layout.height * 0.44)}:line_spacing=${params.layout.subtitleLineSpacing}:fix_bounds=1`,
          `fade=t=in:st=0:d=${FADE_DURATION}`,
          `fade=t=out:st=${Math.max(0.1, params.beat.durationSeconds - FADE_DURATION)}:d=${FADE_DURATION}`,
        ].join(",");

        await runBinary(FFMPEG_BIN, [
          "-y",
          "-f",
          "lavfi",
          "-i",
          `color=c=${params.style.syntheticBackground}:s=${params.layout.width}x${params.layout.height}:d=${params.beat.durationSeconds}`,
          "-vf",
          filter,
          "-r",
          String(DEFAULT_FRAME_RATE),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          params.outputPath,
        ]);
      }),
    ),
  );
}

async function createImageSegmentClip(params: {
  outputPath: string;
  layout: LayoutPreset;
  durationSeconds: number;
  visual: BeatVisualSource;
  style: (typeof VARIANT_STYLES)[number];
  phase: number;
}) {
  const cropPrefix = cropFilterPrefix(params.visual.cropWindow);
  const backgroundScaleW = Math.round(params.layout.width * 1.08);
  const backgroundScaleH = Math.round(params.layout.height * 1.08);
  const foregroundMaxW = params.layout.width - params.layout.imageInset * 2;
  const foregroundMaxH = params.layout.height - params.layout.imageInset * 2;

  const sourcePrefix = cropPrefix ? `${cropPrefix},` : "";
  const complexFilter = [
    `[0:v]${sourcePrefix}split=3[bgsrc][fgsrc][shadowSrc]`,
    `[bgsrc]scale=${backgroundScaleW}:${backgroundScaleH}:force_original_aspect_ratio=increase,crop=${params.layout.width}:${params.layout.height}:x='(in_w-out_w)/2+${driftExpression("x", params.style, params.phase)}':y='(in_h-out_h)/2+${driftExpression("y", params.style, params.phase + 0.6)}',boxblur=28:4,eq=saturation=0.86:brightness=-0.08:contrast=1.08,setsar=1,fps=${DEFAULT_FRAME_RATE},trim=duration=${params.durationSeconds},setpts=PTS-STARTPTS[bg]`,
    `[fgsrc]scale=${foregroundMaxW}:${foregroundMaxH}:force_original_aspect_ratio=decrease,eq=saturation=1.04:brightness=0.01:contrast=1.06,unsharp=5:5:0.55:3:3:0.0,setsar=1,fps=${DEFAULT_FRAME_RATE},trim=duration=${params.durationSeconds},setpts=PTS-STARTPTS[fg]`,
    `[shadowSrc]scale=${foregroundMaxW}:${foregroundMaxH}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=rr=0:gg=0:bb=0:aa=0.28,boxblur=24:2,setsar=1,fps=${DEFAULT_FRAME_RATE},trim=duration=${params.durationSeconds},setpts=PTS-STARTPTS[shadow]`,
    `[bg][shadow]overlay=x='(W-w)/2+${Math.round(params.layout.width * 0.018)}':y='(H-h)/2+${Math.round(params.layout.height * 0.02)}'[shadowed]`,
    `[shadowed][fg]overlay=x='(W-w)/2':y='(H-h)/2',${editorialSurfaceFilters(params.layout, params.style)},format=yuv420p[vout]`,
  ].join(";");

  await runBinary(FFMPEG_BIN, [
    "-loop",
    "1",
    "-i",
    params.visual.assetPath,
    "-t",
    String(params.durationSeconds),
    "-filter_complex",
    complexFilter,
    "-map",
    "[vout]",
    "-an",
    "-r",
    String(DEFAULT_FRAME_RATE),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    params.outputPath,
  ]);
}

async function createVideoSegmentClip(params: {
  outputPath: string;
  layout: LayoutPreset;
  durationSeconds: number;
  inputDuration: number;
  visual: BeatVisualSource;
  style: (typeof VARIANT_STYLES)[number];
  phase: number;
}) {
  const cropPrefix = cropFilterPrefix(params.visual.cropWindow);
  const filters = [
    cropPrefix,
    `scale=${Math.round(params.layout.width * 1.08)}:${Math.round(params.layout.height * 1.08)}:force_original_aspect_ratio=increase`,
    `crop=${params.layout.width}:${params.layout.height}:x='(in_w-out_w)/2+${driftExpression("x", params.style, params.phase)}':y='(in_h-out_h)/2+${driftExpression("y", params.style, params.phase + 0.8)}'`,
    "setsar=1",
    `fps=${DEFAULT_FRAME_RATE}`,
    "eq=saturation=1.05:brightness=-0.02:contrast=1.06",
    "unsharp=5:5:0.45:3:3:0.0",
    params.durationSeconds > params.inputDuration ? `tpad=stop_mode=clone:stop_duration=${Math.max(0, params.durationSeconds - params.inputDuration)}` : null,
    `trim=duration=${params.durationSeconds}`,
    editorialSurfaceFilters(params.layout, params.style),
  ]
    .filter(Boolean)
    .join(",");

  const start = params.visual.shotStartSeconds ?? 0;
  await runBinary(FFMPEG_BIN, [
    "-y",
    "-ss",
    String(start),
    "-t",
    String(params.inputDuration),
    "-i",
    params.visual.assetPath,
    "-vf",
    filters,
    "-an",
    "-r",
    String(DEFAULT_FRAME_RATE),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    params.outputPath,
  ]);
}

async function createVisualSegmentClip(params: {
  outputPath: string;
  layout: LayoutPreset;
  durationSeconds: number;
  visual: BeatVisualSource;
  style: (typeof VARIANT_STYLES)[number];
  phase: number;
}) {
  const isStill = isImagePath(params.visual.assetPath);
  const probe = await probeMedia(params.visual.assetPath);
  const inputDuration = isStill
    ? params.durationSeconds
    : Math.max(
        0.8,
        typeof params.visual.shotStartSeconds === "number" && typeof params.visual.shotEndSeconds === "number"
          ? params.visual.shotEndSeconds - params.visual.shotStartSeconds
          : probe.duration ?? params.durationSeconds,
      );

  if (isStill) {
    await createImageSegmentClip(params);
    return;
  }

  await createVideoSegmentClip({
    ...params,
    inputDuration,
  });
}

async function composeBeatSegments(params: {
  inputPaths: string[];
  visibleDurations: number[];
  transition: string;
  overlapSeconds: number;
  outputPath: string;
}) {
  if (params.inputPaths.length === 1) {
    await fs.copyFile(params.inputPaths[0]!, params.outputPath);
    return;
  }

  const filterParts: string[] = [];
  let currentLabel = "[0:v]";
  let offset = params.visibleDurations[0] ?? 0;

  for (let index = 1; index < params.inputPaths.length; index += 1) {
    const outputLabel = index === params.inputPaths.length - 1 ? "[vout]" : `[xf${index}]`;
    filterParts.push(
      `${currentLabel}[${index}:v]xfade=transition=${params.transition}:duration=${params.overlapSeconds}:offset=${offset.toFixed(2)}${outputLabel}`,
    );
    currentLabel = outputLabel;
    offset += params.visibleDurations[index] ?? 0;
  }

  await runBinary(FFMPEG_BIN, [
    "-y",
    ...params.inputPaths.flatMap((inputPath) => ["-i", inputPath]),
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    currentLabel,
    "-an",
    "-r",
    String(DEFAULT_FRAME_RATE),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    params.outputPath,
  ]);
}

async function applyBeatIntroOverlay(params: {
  inputPath: string;
  outputPath: string;
  layout: LayoutPreset;
  beat: StoryboardBeat;
  style: (typeof VARIANT_STYLES)[number];
}) {
  const titleText = wrapOverlayText(params.beat.titleOverlay?.text ?? params.beat.title, params.layout.titleLineLength, 2);
  const labelText = params.beat.titleOverlay?.label ?? beatLabel(params.beat);

  await withOverlayTextFile({ basePath: params.outputPath, suffix: "title", text: titleText }, async (titleFilePath) =>
    withOverlayTextFile({ basePath: params.outputPath, suffix: "label", text: labelText }, async (labelFilePath) => {
      const filter = buildBeatIntroFilter({
        layout: params.layout,
        beat: params.beat,
        style: params.style,
        titleFilePath,
        labelFilePath,
      });

      await runBinary(FFMPEG_BIN, [
        "-y",
        "-i",
        params.inputPath,
        "-vf",
        filter,
        "-an",
        "-r",
        String(DEFAULT_FRAME_RATE),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        params.outputPath,
      ]);
    }),
  );
}

async function createBeatClip(params: {
  outputPath: string;
  layout: LayoutPreset;
  beat: StoryboardBeat;
  style: (typeof VARIANT_STYLES)[number];
}) {
  const visuals = beatVisualSources(params.beat);
  if (visuals.length === 0) {
    await createSyntheticClip(params);
    return;
  }
  const visibleDurations = splitBeatDuration(params.beat.durationSeconds, visuals.length);
  const overlapSeconds = sequenceTransitionOverlap(params.beat.durationSeconds, visuals.length);
  const segmentDir = `${params.outputPath}.segments`;
  await ensureDir(segmentDir);

  const visualSegmentPaths: string[] = [];
  for (let index = 0; index < visuals.length; index += 1) {
    const segmentPath = path.join(segmentDir, `segment-${index + 1}.mp4`);
    await createVisualSegmentClip({
      outputPath: segmentPath,
      layout: params.layout,
      durationSeconds: (visibleDurations[index] ?? params.beat.durationSeconds) + (index < visuals.length - 1 ? overlapSeconds : 0),
      visual: visuals[index]!,
      style: params.style,
      phase: index * 0.75 + params.beat.order * 0.2,
    });
    visualSegmentPaths.push(segmentPath);
  }

  const visualOnlyPath = `${params.outputPath}.visual.mp4`;
  await composeBeatSegments({
    inputPaths: visualSegmentPaths,
    visibleDurations,
    transition: params.style.transition,
    overlapSeconds,
    outputPath: visualOnlyPath,
  });
  await applyBeatIntroOverlay({
    inputPath: visualOnlyPath,
    outputPath: params.outputPath,
    layout: params.layout,
    beat: params.beat,
    style: params.style,
  });
  await fs.rm(segmentDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.unlink(visualOnlyPath).catch(() => undefined);
}

async function resolveGeneratedBeatMedia(params: {
  userId: string;
  jobId: string;
  storyboard: StoryboardPlan;
  beat: StoryboardBeat;
}): Promise<{
  beat: StoryboardBeat;
  generatedVideoBeatCount: number;
  generatedVideoFailureCount: number;
}> {
  const requestedKind = params.beat.generatedAssetPlan?.requestedKind ?? "still";
  const basePlan: NonNullable<StoryboardBeat["generatedAssetPlan"]> = params.beat.generatedAssetPlan ?? {
    requestedKind,
    status: params.beat.generatedVisualStatus ?? ("planned" as const),
    provider: requestedKind === "motion" ? ("gemini-video" as const) : ("gemini-image" as const),
    prompt: params.beat.generatedVisualPrompt ?? params.beat.title,
  };
  const existingSelectedPath =
    params.beat.selectedAssetPath && existsSync(params.beat.selectedAssetPath) ? params.beat.selectedAssetPath : null;

  if (existingSelectedPath && !isImagePath(existingSelectedPath)) {
    return {
      beat: {
        ...params.beat,
        selectedAssetPath: existingSelectedPath,
        generatedVisualStatus: params.beat.generatedVisualStatus === "planned" ? "generated" : params.beat.generatedVisualStatus,
        generatedAssetPlan: {
          ...basePlan,
          resolvedKind: "motion",
          status: "generated",
          assetPath: existingSelectedPath,
          previewPath: params.beat.generatedPreviewPath ?? basePlan.previewPath ?? null,
          error: null,
        },
      },
      generatedVideoBeatCount: 1,
      generatedVideoFailureCount: 0,
    };
  }

  const existingReferenceImage = [params.beat.generatedPreviewPath, existingSelectedPath].find(
    (candidate): candidate is string => Boolean(candidate && isImagePath(candidate) && existsSync(candidate)),
  );
  const generatedResult = await createGeneratedSupportingAssetDetailed({
    userId: params.userId,
    scopeId: params.jobId,
    beatId: params.beat.beatId,
    prompt: params.beat.generatedVisualPrompt ?? params.beat.title,
    format: params.storyboard.format,
    preferredKind: requestedKind,
    initialImagePath: existingReferenceImage,
    scope: "render",
    allowStillFallback: true,
  });

  if (generatedResult.path) {
    const resolvedKind = generatedResult.resolvedKind ?? (isImagePath(generatedResult.path) ? ("still" as const) : ("motion" as const));
    const previewPath =
      generatedResult.previewPath ??
      params.beat.generatedPreviewPath ??
      (isImagePath(generatedResult.path) ? generatedResult.path : null);
    const fellBackFromMotion = generatedResult.degradedFrom === "motion";
    return {
      beat: {
        ...params.beat,
        selectedAssetPath: generatedResult.path,
        generatedPreviewPath: previewPath,
        assetType: "generated" as const,
        generatedVisualStatus: "generated" as const,
        matchReason: fellBackFromMotion
          ? `${params.beat.matchReason} Motion generation was unavailable, so the render fell back to a generated still.`
          : params.beat.matchReason,
        analysisNote: generatedResult.error ?? params.beat.analysisNote,
        generatedAssetPlan: {
          ...basePlan,
          resolvedKind,
          status: "generated",
          provider: generatedResult.provider,
          assetPath: generatedResult.path,
          previewPath,
          fallbackAssetPath: generatedResult.fallbackAssetPath ?? null,
          degradedFrom: generatedResult.degradedFrom,
          error: generatedResult.error,
        },
      },
      generatedVideoBeatCount: resolvedKind === "motion" ? 1 : 0,
      generatedVideoFailureCount: requestedKind === "motion" && resolvedKind !== "motion" ? 1 : 0,
    };
  }

  return {
    beat: {
      ...params.beat,
      mediaSource: "synthetic" as const,
      assetType: "none" as const,
      selectedAssetPath: null,
      generatedVisualStatus: "unavailable" as const,
      matchReason: `${params.beat.matchReason} Generated support was unavailable, so a clean fallback card will be used instead.`,
      analysisNote: generatedResult.error ?? params.beat.analysisNote,
      generatedAssetPlan: {
        ...basePlan,
        status: "unavailable",
        error: generatedResult.error,
      },
    },
    generatedVideoBeatCount: 0,
    generatedVideoFailureCount: requestedKind === "motion" ? 1 : 0,
  };
}

async function resolveStoryboardAssets(params: {
  userId: string;
  jobId: string;
  storyboard: StoryboardPlan;
}) {
  const beats: StoryboardBeat[] = [];
  let generatedVideoBeatCount = 0;
  let generatedVideoFailureCount = 0;

  for (const beat of params.storyboard.beats) {
    if (beat.mediaSource !== "generated" || !beat.generatedVisualPrompt) {
      const supportingVisuals: StoryboardSupportingVisual[] = [];
      for (const visual of beat.supportingVisuals ?? []) {
        if (visual.mediaSource !== "generated" || !visual.generatedVisualPrompt) {
          supportingVisuals.push(visual);
          continue;
        }

        if (visual.assetPath && existsSync(visual.assetPath)) {
          supportingVisuals.push({
            ...visual,
            generatedVisualStatus: visual.generatedVisualStatus === "planned" ? "generated" : visual.generatedVisualStatus,
            generatedAssetPlan: visual.generatedAssetPlan
              ? {
                  ...visual.generatedAssetPlan,
                  resolvedKind: isImagePath(visual.assetPath) ? "still" : "motion",
                  status: "generated",
                  assetPath: visual.assetPath,
                  previewPath: visual.generatedPreviewPath ?? visual.generatedAssetPlan.previewPath ?? null,
                }
              : visual.generatedAssetPlan,
          });
          continue;
        }

        const generatedResult = await createGeneratedSupportingAssetDetailed({
          userId: params.userId,
          scopeId: params.jobId,
          beatId: visual.visualId,
          prompt: visual.generatedVisualPrompt,
          format: params.storyboard.format,
          preferredKind: visual.generatedAssetPlan?.requestedKind ?? "still",
          scope: "render",
          allowStillFallback: true,
        });

        supportingVisuals.push(
          generatedResult.path
            ? {
                ...visual,
                assetPath: generatedResult.path,
                generatedPreviewPath:
                  generatedResult.previewPath ?? (isImagePath(generatedResult.path) ? generatedResult.path : visual.generatedPreviewPath ?? null),
                generatedVisualStatus: "generated",
                generatedAssetPlan: visual.generatedAssetPlan
                  ? {
                      ...visual.generatedAssetPlan,
                      resolvedKind: generatedResult.resolvedKind ?? (isImagePath(generatedResult.path) ? "still" : "motion"),
                      status: "generated",
                      provider: generatedResult.provider,
                      assetPath: generatedResult.path,
                      previewPath:
                        generatedResult.previewPath ??
                        (isImagePath(generatedResult.path) ? generatedResult.path : visual.generatedPreviewPath ?? null),
                      fallbackAssetPath: generatedResult.fallbackAssetPath ?? null,
                      degradedFrom: generatedResult.degradedFrom,
                      error: generatedResult.error,
                    }
                  : visual.generatedAssetPlan,
              }
            : {
                ...visual,
                assetPath: null,
                generatedPreviewPath: null,
                generatedVisualStatus: "unavailable",
                generatedAssetPlan: visual.generatedAssetPlan
                  ? {
                      ...visual.generatedAssetPlan,
                      status: "unavailable",
                      error: generatedResult.error,
                    }
                  : visual.generatedAssetPlan,
              },
        );
      }

      beats.push({
        ...beat,
        supportingVisuals,
      });
      continue;
    }

    const resolvedGenerated = await resolveGeneratedBeatMedia({
      userId: params.userId,
      jobId: params.jobId,
      storyboard: params.storyboard,
      beat,
    });
    generatedVideoBeatCount += resolvedGenerated.generatedVideoBeatCount;
    generatedVideoFailureCount += resolvedGenerated.generatedVideoFailureCount;
    beats.push(resolvedGenerated.beat);
  }

  return {
    storyboard: {
      ...params.storyboard,
      beats,
    },
    generatedVideoBeatCount,
    generatedVideoFailureCount,
  };
}

async function applyTimedSubtitles(params: {
  inputPath: string;
  outputPath: string;
  layout: LayoutPreset;
  style: (typeof VARIANT_STYLES)[number];
  cues: StoryboardPlan["subtitleCues"];
}) {
  const cues = (params.cues ?? []).filter((cue) => cue.endSeconds > cue.startSeconds);

  if (cues.length === 0) {
    await fs.copyFile(params.inputPath, params.outputPath);
    return;
  }

  const subtitleDir = `${params.outputPath}.subtitles`;
  await ensureDir(subtitleDir);

  const textFiles: string[] = [];

  try {
    const filterParts: string[] = [];

    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index]!;
      const wrappedText = wrapOverlayText(cue.text, params.layout.subtitleLineLength, params.layout.subtitleMaxLines);
      if (!wrappedText) {
        continue;
      }

      const textFilePath = path.join(subtitleDir, `cue-${String(index + 1).padStart(2, "0")}.txt`);
      textFiles.push(textFilePath);
      await fs.writeFile(textFilePath, wrappedText, "utf8");

      const lineCount = wrappedText.split("\n").length;
      const textY = subtitleBoxY(params.layout, lineCount);
      const alphaExpr = `if(lt(t,${(cue.startSeconds + SUBTITLE_FADE_DURATION).toFixed(2)}),(t-${cue.startSeconds.toFixed(2)})/${SUBTITLE_FADE_DURATION.toFixed(2)},if(gt(t,${(cue.endSeconds - SUBTITLE_FADE_DURATION).toFixed(2)}),(${cue.endSeconds.toFixed(2)}-t)/${SUBTITLE_FADE_DURATION.toFixed(2)},1))`;
      const enableExpr = `between(t,${cue.startSeconds.toFixed(2)},${cue.endSeconds.toFixed(2)})`;

      filterParts.push(
        `drawbox=x=${params.layout.subtitleX}:y=${params.layout.subtitleY}:w=${params.layout.subtitleBoxW}:h=${params.layout.subtitleBoxH}:color=black@0.66:t=fill:enable='${enableExpr}'`,
      );
      filterParts.push(
        `drawbox=x=${params.layout.subtitleX}:y=${params.layout.subtitleY}:w=${params.layout.subtitleBoxW}:h=4:color=${params.style.accentColor}@0.92:t=fill:enable='${enableExpr}'`,
      );
      filterParts.push(
        `drawtext=textfile='${escapeFilterValue(textFilePath)}':expansion=none${drawtextFontOption(BODY_FONT_FILE, "body")}:fontcolor=white:fontsize=${params.layout.subtitleFontSize}:x=(w-text_w)/2:y=${textY}:line_spacing=${params.layout.subtitleLineSpacing}:fix_bounds=1:shadowcolor=0x020617@1:shadowx=0:shadowy=4:alpha='${alphaExpr}':enable='${enableExpr}'`,
      );
    }

    if (filterParts.length === 0) {
      await fs.copyFile(params.inputPath, params.outputPath);
      return;
    }

    await runBinary(FFMPEG_BIN, [
      "-y",
      "-i",
      params.inputPath,
      "-vf",
      filterParts.join(","),
      "-an",
      "-r",
      String(DEFAULT_FRAME_RATE),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      params.outputPath,
    ]);
  } finally {
    await Promise.all(textFiles.map((textFilePath) => fs.unlink(textFilePath).catch(() => undefined)));
    await fs.rm(subtitleDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function renderVideoVariants(params: {
  userId: string;
  jobId: string;
  title: string;
  storyboard: StoryboardPlan;
}): Promise<RenderOutput> {
  await ensureFfmpegInstalled();
  ensureRenderFontsAvailable();

  const outputDir = path.join(process.cwd(), "renders", params.userId, params.jobId);
  await ensureDir(outputDir);

  const resolvedStoryboardResult = await resolveStoryboardAssets({
    userId: params.userId,
    jobId: params.jobId,
    storyboard: applyStoryboardEditorialTiming(params.storyboard),
  });
  const resolvedStoryboard = applyStoryboardEditorialTiming(resolvedStoryboardResult.storyboard);
  const layout = layoutForFormat(resolvedStoryboard.format);
  const variants: RenderOutput["variants"] = [];
  const narrationTrack = await buildNarrationTrack({
    userId: params.userId,
    jobId: params.jobId,
    storyboard: resolvedStoryboard,
  });
  const timedStoryboard = narrationTrack.storyboard ?? resolvedStoryboard;

  for (let index = 0; index < VARIANT_STYLES.length; index += 1) {
    const style = VARIANT_STYLES[index];
    const tempDir = path.join(outputDir, `tmp-${index + 1}`);
    await ensureDir(tempDir);

    const clipPaths: string[] = [];
    for (const beat of timedStoryboard.beats) {
      const clipPath = path.join(tempDir, `${beat.beatId}.mp4`);
      await createBeatClip({
        outputPath: clipPath,
        layout,
        beat,
        style,
      });
      clipPaths.push(clipPath);
    }

    const silentPath = path.join(outputDir, `variant-${index + 1}.silent.mp4`);
    const subtitledPath = path.join(outputDir, `variant-${index + 1}.subtitled.mp4`);
    const finalPath = path.join(outputDir, `variant-${index + 1}.mp4`);
    await concatClips(clipPaths, silentPath);
    await applyTimedSubtitles({
      inputPath: silentPath,
      outputPath: subtitledPath,
      layout,
      style,
      cues: narrationTrack.subtitleCues,
    });
    await fs.unlink(silentPath).catch(() => undefined);

    if (narrationTrack.path) {
      await muxAudioTrack({
        videoPath: subtitledPath,
        audioPath: narrationTrack.path,
        outputPath: finalPath,
      });
      await fs.unlink(subtitledPath).catch(() => undefined);
    } else {
      await fs.rename(subtitledPath, finalPath);
    }

    const finalProbe = await probeMedia(finalPath);

    variants.push({
      variantIndex: index + 1,
      path: finalPath,
      duration: Math.round(timedStoryboard.durationSeconds ?? timedStoryboard.beats.reduce((sum, beat) => sum + beat.durationSeconds, 0)),
      hasAudio: finalProbe.hasAudio ?? false,
      audioSummary: narrationTrack.audioComposition.summary,
    });
  }

  return {
    format: resolvedStoryboard.format,
    reason: resolvedStoryboard.coverageSummary,
    variants,
    audioStatus: narrationTrack.path ? "generated" : "missing",
    audioError: narrationTrack.path ? narrationTrack.error : narrationTrack.error ?? "Generated narration was unavailable.",
    audioComposition: narrationTrack.audioComposition,
    generatedVideoBeatCount: resolvedStoryboardResult.generatedVideoBeatCount,
    generatedVideoFailureCount: resolvedStoryboardResult.generatedVideoFailureCount,
    storyboard: timedStoryboard,
  };
}

export const renderTestUtils = {
  escapeFilterValue,
  requireFontFile,
  sanitizeOverlayText,
  wrapOverlayText,
  pickFormat,
  resolutionForFormat,
};
