import { promises as fs } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";

import { createGeneratedSupportingImage } from "@/lib/generated-media";
import { ensureDir, ensureFfmpegInstalled, FFMPEG_BIN, isImagePath, probeMedia, runBinary } from "@/lib/ffmpeg";
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

const VARIANT_STYLES = [
  {
    accentColor: "0xF97316",
    titleChip: "0x111827",
    syntheticBackground: "0x0F172A",
    panSpeed: 0.5,
  },
  {
    accentColor: "0x10B981",
    titleChip: "0x052E2B",
    syntheticBackground: "0x062C2C",
    panSpeed: 0.62,
  },
  {
    accentColor: "0x2563EB",
    titleChip: "0x172554",
    syntheticBackground: "0x0F1C3C",
    panSpeed: 0.56,
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
  captionX: number;
  captionY: number;
  captionBoxW: number;
  captionBoxH: number;
  captionFontSize: number;
  captionLineLength: number;
  captionMaxLines: number;
  labelFontSize: number;
  labelYOffset: number;
  captionTextYOffset: number;
};

function escapeFilterValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function sanitizeOverlayText(text: string, maxLength: number) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function wrapOverlayText(text: string, maxLineLength: number, maxLines: number) {
  const words = sanitizeOverlayText(text, maxLineLength * maxLines * 2)
    .split(" ")
    .filter(Boolean);

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxLineLength) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(word.slice(0, maxLineLength));
      currentLine = word.slice(maxLineLength);
    }

    if (lines.length === maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  if (lines.length === 0) {
    return "";
  }

  const hasOverflow = words.join(" ").length > lines.join(" ").length;
  if (hasOverflow) {
    const lastLine = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = lastLine.length >= maxLineLength ? `${lastLine.slice(0, maxLineLength - 1)}…` : `${lastLine}…`;
  }

  return lines.join("\n");
}

function compactOverlayCopy(text: string, maxLength: number) {
  const normalized = sanitizeOverlayText(text, maxLength * 2);
  const firstClause = normalized.split(/[.:;!?]/)[0]?.trim() ?? normalized;
  if (firstClause.length <= maxLength) {
    return firstClause;
  }

  const shortened = firstClause.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${(lastSpace > 18 ? shortened.slice(0, lastSpace) : shortened).trim()}…`;
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
      titleX: 72,
      titleY: 82,
      titleBoxW: 936,
      titleBoxH: 128,
      titleFontSize: 42,
      titleLineLength: 28,
      titleDuration: 1.2,
      captionX: 72,
      captionY: 1288,
      captionBoxW: 936,
      captionBoxH: 230,
      captionFontSize: 46,
      captionLineLength: 22,
      captionMaxLines: 3,
      labelFontSize: 28,
      labelYOffset: 28,
      captionTextYOffset: 78,
    };
  }

  return {
    width: 1920,
    height: 1080,
    titleX: 108,
    titleY: 72,
    titleBoxW: 1704,
    titleBoxH: 116,
    titleFontSize: 46,
    titleLineLength: 34,
    titleDuration: 1.25,
    captionX: 108,
    captionY: 636,
    captionBoxW: 1704,
    captionBoxH: 170,
    captionFontSize: 44,
    captionLineLength: 34,
    captionMaxLines: 2,
    labelFontSize: 26,
    labelYOffset: 24,
    captionTextYOffset: 60,
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

function animatedImageFilter(layout: LayoutPreset, duration: number, panSpeed: number, cropWindow?: NormalizedCropWindow) {
  const scaledWidth = Math.round(layout.width * 1.12);
  const scaledHeight = Math.round(layout.height * 1.12);
  return [
    cropFilterPrefix(cropWindow),
    `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase`,
    `crop=${layout.width}:${layout.height}:x='(in_w-out_w)/2+((in_w-out_w)*0.10)*sin(t*${panSpeed})':y='(in_h-out_h)/2+((in_h-out_h)*0.08)*cos(t*${panSpeed})'`,
    "setsar=1",
    "fps=30",
    `trim=duration=${duration}`,
    "setpts=PTS-STARTPTS",
  ]
    .filter(Boolean)
    .join(",");
}

function videoFilter(layout: LayoutPreset, duration: number, extensionDuration: number) {
  const filters = [
    `scale=${layout.width}:${layout.height}:force_original_aspect_ratio=increase`,
    `crop=${layout.width}:${layout.height}`,
    "setsar=1",
    "fps=30",
    "eq=saturation=1.03:brightness=-0.01:contrast=1.04",
    "setpts=PTS-STARTPTS",
  ];

  if (extensionDuration > 0) {
    filters.push(`tpad=stop_mode=clone:stop_duration=${extensionDuration}`);
  }

  filters.push(`trim=duration=${duration}`);
  return filters.join(",");
}

async function createSyntheticClip(params: {
  outputPath: string;
  layout: LayoutPreset;
  beat: StoryboardBeat;
  style: (typeof VARIANT_STYLES)[number];
}) {
  const titleText = wrapOverlayText(params.beat.title, params.layout.titleLineLength, 2);
  const captionText = wrapOverlayText(
    compactOverlayCopy(params.beat.caption || params.beat.title, params.layout.captionLineLength * 2),
    params.layout.captionLineLength,
    Math.min(2, params.layout.captionMaxLines),
  );
  const labelText = beatLabel(params.beat);

  await withOverlayTextFile({ basePath: params.outputPath, suffix: "title", text: titleText }, async (titleFilePath) =>
    withOverlayTextFile({ basePath: params.outputPath, suffix: "caption", text: captionText }, async (captionFilePath) =>
      withOverlayTextFile({ basePath: params.outputPath, suffix: "label", text: labelText }, async (labelFilePath) => {
        const filter = [
          `drawbox=x=${params.layout.titleX}:y=${params.layout.titleY}:w=${params.layout.titleBoxW}:h=${params.layout.titleBoxH}:color=${params.style.titleChip}@0.88:t=fill:enable='between(t,0,${params.layout.titleDuration})'`,
          `drawbox=x=${params.layout.captionX}:y=${params.layout.captionY}:w=${params.layout.captionBoxW}:h=${params.layout.captionBoxH}:color=black@0.56:t=fill`,
          `drawbox=x=${params.layout.captionX}:y=${params.layout.captionY}:w=${params.layout.captionBoxW}:h=4:color=${params.style.accentColor}@1:t=fill`,
          `drawtext=textfile='${escapeFilterValue(titleFilePath)}':expansion=none:fontcolor=white:fontsize=${params.layout.titleFontSize}:x=${params.layout.titleX + 36}:y=${params.layout.titleY + 28}:line_spacing=10:fix_bounds=1:enable='between(t,0,${params.layout.titleDuration})'`,
          `drawtext=textfile='${escapeFilterValue(labelFilePath)}':expansion=none:fontcolor=${params.style.accentColor}:fontsize=${params.layout.labelFontSize}:x=${params.layout.captionX + 34}:y=${params.layout.captionY + params.layout.labelYOffset}:fix_bounds=1`,
          `drawtext=textfile='${escapeFilterValue(captionFilePath)}':expansion=none:fontcolor=white:fontsize=${params.layout.captionFontSize}:x=${params.layout.captionX + 34}:y=${params.layout.captionY + params.layout.captionTextYOffset}:line_spacing=14:fix_bounds=1`,
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
          "30",
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

async function createVisualSegmentClip(params: {
  outputPath: string;
  layout: LayoutPreset;
  durationSeconds: number;
  visual: BeatVisualSource;
  style: (typeof VARIANT_STYLES)[number];
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

  const visualFilter = isStill
    ? animatedImageFilter(params.layout, params.durationSeconds, params.style.panSpeed, params.visual.cropWindow)
    : videoFilter(params.layout, params.durationSeconds, Math.max(0, params.durationSeconds - inputDuration));

  const commonOutput = [
    "-y",
    "-vf",
    visualFilter,
    "-an",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    params.outputPath,
  ];

  if (isStill) {
    await runBinary(FFMPEG_BIN, ["-loop", "1", "-i", params.visual.assetPath, "-t", String(params.durationSeconds), ...commonOutput]);
    return;
  }

  const start = params.visual.shotStartSeconds ?? 0;
  await runBinary(FFMPEG_BIN, ["-ss", String(start), "-t", String(inputDuration), "-i", params.visual.assetPath, ...commonOutput]);
}

async function applyBeatOverlay(params: {
  inputPath: string;
  outputPath: string;
  layout: LayoutPreset;
  beat: StoryboardBeat;
  style: (typeof VARIANT_STYLES)[number];
}) {
  const titleText = wrapOverlayText(params.beat.title, params.layout.titleLineLength, 2);
  const captionText = wrapOverlayText(
    compactOverlayCopy(params.beat.caption || params.beat.title, params.layout.captionLineLength * 2),
    params.layout.captionLineLength,
    Math.min(2, params.layout.captionMaxLines),
  );
  const labelText = beatLabel(params.beat);

  await withOverlayTextFile({ basePath: params.outputPath, suffix: "title", text: titleText }, async (titleFilePath) =>
    withOverlayTextFile({ basePath: params.outputPath, suffix: "caption", text: captionText }, async (captionFilePath) =>
      withOverlayTextFile({ basePath: params.outputPath, suffix: "label", text: labelText }, async (labelFilePath) => {
        const filter = [
          `drawbox=x=${params.layout.titleX}:y=${params.layout.titleY}:w=${params.layout.titleBoxW}:h=${params.layout.titleBoxH}:color=${params.style.titleChip}@0.84:t=fill:enable='between(t,0,${params.layout.titleDuration})'`,
          `drawbox=x=${params.layout.captionX}:y=${params.layout.captionY}:w=${params.layout.captionBoxW}:h=${params.layout.captionBoxH}:color=black@0.56:t=fill`,
          `drawbox=x=${params.layout.captionX}:y=${params.layout.captionY}:w=${params.layout.captionBoxW}:h=4:color=${params.style.accentColor}@1:t=fill`,
          `drawtext=textfile='${escapeFilterValue(titleFilePath)}':expansion=none:fontcolor=white:fontsize=${params.layout.titleFontSize}:x=${params.layout.titleX + 36}:y=${params.layout.titleY + 24}:line_spacing=10:fix_bounds=1:enable='between(t,0,${params.layout.titleDuration})'`,
          `drawtext=textfile='${escapeFilterValue(labelFilePath)}':expansion=none:fontcolor=${params.style.accentColor}:fontsize=${params.layout.labelFontSize}:x=${params.layout.captionX + 34}:y=${params.layout.captionY + params.layout.labelYOffset}:fix_bounds=1`,
          `drawtext=textfile='${escapeFilterValue(captionFilePath)}':expansion=none:fontcolor=white:fontsize=${params.layout.captionFontSize}:x=${params.layout.captionX + 34}:y=${params.layout.captionY + params.layout.captionTextYOffset}:line_spacing=12:fix_bounds=1`,
          `fade=t=in:st=0:d=${FADE_DURATION}`,
          `fade=t=out:st=${Math.max(0.1, params.beat.durationSeconds - FADE_DURATION)}:d=${FADE_DURATION}`,
        ].join(",");

        await runBinary(FFMPEG_BIN, [
          "-y",
          "-i",
          params.inputPath,
          "-vf",
          filter,
          "-an",
          "-r",
          "30",
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
  const segmentDurations = splitBeatDuration(params.beat.durationSeconds, visuals.length);
  const segmentDir = `${params.outputPath}.segments`;
  await ensureDir(segmentDir);

  const visualSegmentPaths: string[] = [];
  for (let index = 0; index < visuals.length; index += 1) {
    const segmentPath = path.join(segmentDir, `segment-${index + 1}.mp4`);
    await createVisualSegmentClip({
      outputPath: segmentPath,
      layout: params.layout,
      durationSeconds: segmentDurations[index] ?? params.beat.durationSeconds,
      visual: visuals[index]!,
      style: params.style,
    });
    visualSegmentPaths.push(segmentPath);
  }

  const visualOnlyPath = `${params.outputPath}.visual.mp4`;
  await concatClips(visualSegmentPaths, visualOnlyPath);
  await applyBeatOverlay({
    inputPath: visualOnlyPath,
    outputPath: params.outputPath,
    layout: params.layout,
    beat: params.beat,
    style: params.style,
  });
  await fs.rm(segmentDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.unlink(visualOnlyPath).catch(() => undefined);
}

async function resolveStoryboardAssets(params: {
  userId: string;
  jobId: string;
  storyboard: StoryboardPlan;
}) {
  const beats: StoryboardBeat[] = [];

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
          });
          continue;
        }

        const generatedPath = await createGeneratedSupportingImage({
          userId: params.userId,
          scopeId: params.jobId,
          beatId: visual.visualId,
          prompt: visual.generatedVisualPrompt,
          format: params.storyboard.format,
          scope: "render",
        });

        supportingVisuals.push(
          generatedPath
            ? {
                ...visual,
                assetPath: generatedPath,
                generatedPreviewPath: generatedPath,
                generatedVisualStatus: "generated",
              }
            : {
                ...visual,
                assetPath: null,
                generatedPreviewPath: null,
                generatedVisualStatus: "unavailable",
              },
        );
      }

      beats.push({
        ...beat,
        supportingVisuals,
      });
      continue;
    }

    if (beat.selectedAssetPath && existsSync(beat.selectedAssetPath)) {
      beats.push({
        ...beat,
        generatedVisualStatus: beat.generatedVisualStatus === "planned" ? "generated" : beat.generatedVisualStatus,
      });
      continue;
    }

    const generatedPath = await createGeneratedSupportingImage({
      userId: params.userId,
      scopeId: params.jobId,
      beatId: beat.beatId,
      prompt: beat.generatedVisualPrompt,
      format: params.storyboard.format,
      scope: "render",
    });

    if (generatedPath) {
      beats.push({
        ...beat,
        selectedAssetPath: generatedPath,
        assetType: "generated",
        generatedVisualStatus: "generated",
      });
      continue;
    }

    beats.push({
      ...beat,
      mediaSource: "synthetic",
      assetType: "none",
      selectedAssetPath: null,
      generatedVisualStatus: "unavailable",
      matchReason: `${beat.matchReason} Generated support was unavailable, so a clean fallback card will be used instead.`,
    });
  }

  return {
    ...params.storyboard,
    beats,
  };
}

export async function renderVideoVariants(params: {
  userId: string;
  jobId: string;
  title: string;
  storyboard: StoryboardPlan;
}): Promise<RenderOutput> {
  await ensureFfmpegInstalled();

  const outputDir = path.join(process.cwd(), "renders", params.userId, params.jobId);
  await ensureDir(outputDir);

  const resolvedStoryboard = await resolveStoryboardAssets({
    userId: params.userId,
    jobId: params.jobId,
    storyboard: params.storyboard,
  });
  const layout = layoutForFormat(resolvedStoryboard.format);
  const variants: RenderOutput["variants"] = [];
  const narrationTrack = await buildNarrationTrack({
    userId: params.userId,
    jobId: params.jobId,
    storyboard: resolvedStoryboard,
  });

  for (let index = 0; index < VARIANT_STYLES.length; index += 1) {
    const style = VARIANT_STYLES[index];
    const tempDir = path.join(outputDir, `tmp-${index + 1}`);
    await ensureDir(tempDir);

    const clipPaths: string[] = [];
    for (const beat of resolvedStoryboard.beats) {
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
    const finalPath = path.join(outputDir, `variant-${index + 1}.mp4`);
    await concatClips(clipPaths, silentPath);

    if (narrationTrack.path) {
      await muxAudioTrack({
        videoPath: silentPath,
        audioPath: narrationTrack.path,
        outputPath: finalPath,
      });
      await fs.unlink(silentPath).catch(() => undefined);
    } else {
      await fs.rename(silentPath, finalPath);
    }

    const finalProbe = await probeMedia(finalPath);

    variants.push({
      variantIndex: index + 1,
      path: finalPath,
      duration: Math.round(resolvedStoryboard.beats.reduce((sum, beat) => sum + beat.durationSeconds, 0)),
      hasAudio: finalProbe.hasAudio ?? false,
    });
  }

  return {
    format: resolvedStoryboard.format,
    reason: resolvedStoryboard.coverageSummary,
    variants,
    audioStatus: narrationTrack.path ? "generated" : "missing",
    audioError: narrationTrack.path ? narrationTrack.error : narrationTrack.error ?? "Generated narration was unavailable.",
    storyboard: resolvedStoryboard,
  };
}

export const renderTestUtils = {
  escapeFilterValue,
  sanitizeOverlayText,
  wrapOverlayText,
  pickFormat,
  resolutionForFormat,
};
