import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { RenderFormat, RenderOutput, RenderPreference } from "@/lib/types";

const execFileAsync = promisify(execFile);

function resolveBundledBinary(relativePath: string[]) {
  const candidate = path.join(process.cwd(), "node_modules", ...relativePath);
  return existsSync(candidate) ? candidate : null;
}

const FFMPEG_BIN =
  process.env.FFMPEG_PATH ??
  resolveBundledBinary(["ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"]) ??
  "ffmpeg";

const FFPROBE_BIN =
  process.env.FFPROBE_PATH ??
  resolveBundledBinary([
    "ffprobe-static",
    "bin",
    process.platform,
    process.arch,
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  ]) ??
  "ffprobe";

const INTRO_DURATION = 2;
const OUTRO_DURATION = 2;
const DEFAULT_SHORTS_BODY = 24;
const DEFAULT_LANDSCAPE_BODY = 45;

const VARIANT_STYLES = [
  { introColor: "0x0F172A", outroColor: "0x111827", accentColor: "white" },
  { introColor: "0x1E3A8A", outroColor: "0x172554", accentColor: "yellow" },
  { introColor: "0x065F46", outroColor: "0x064E3B", accentColor: "white" },
];

type ProbeResult = {
  width?: number;
  height?: number;
  duration?: number;
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

  if (lines.length > maxLines) {
    return `${lines.slice(0, maxLines).join("\n").slice(0, -1)}...`;
  }

  const hasOverflow = words.join(" ").length > lines.join(" ").length;
  if (hasOverflow) {
    const lastLine = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = lastLine.length >= maxLineLength ? `${lastLine.slice(0, maxLineLength - 1)}…` : `${lastLine}…`;
  }

  return lines.join("\n");
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

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function runBinary(command: string, args: string[]) {
  try {
    await execFileAsync(command, args, {
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      if (command === FFMPEG_BIN) {
        throw new Error("FFmpeg is unavailable. Install it locally or set FFMPEG_PATH.");
      }

      if (command === FFPROBE_BIN) {
        throw new Error("FFprobe is unavailable. Install it locally or set FFPROBE_PATH.");
      }
    }

    throw error;
  }
}

async function ensureFfmpegInstalled() {
  await runBinary(FFMPEG_BIN, ["-version"]);
  await runBinary(FFPROBE_BIN, ["-version"]);
}

function isImage(inputPath: string) {
  return /\.(png|jpg|jpeg)$/i.test(inputPath);
}

async function probeMedia(inputPath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      inputPath,
    ]);

    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };

    const stream = parsed.streams?.find((candidate) => candidate.width && candidate.height);

    return {
      width: stream?.width,
      height: stream?.height,
      duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
    };
  } catch {
    return {};
  }
}

function splitIntoSegments(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildBodySegments(params: { hook: string; bulletOutline?: string[] }) {
  const segments = [...splitIntoSegments(params.hook), ...(params.bulletOutline ?? [])]
    .map((segment) => sanitizeOverlayText(segment, 180))
    .filter(Boolean);

  return segments.slice(0, 4);
}

function pickFormat(preference: RenderPreference, probe: ProbeResult): { format: RenderFormat; reason: string } {
  if (preference === "shorts") {
    return {
      format: "shorts",
      reason: "User preference set to Shorts (1080x1920).",
    };
  }

  if (preference === "landscape") {
    return {
      format: "landscape",
      reason: "User preference set to landscape (1920x1080).",
    };
  }

  if (probe.height && probe.width && probe.height > probe.width) {
    return {
      format: "shorts",
      reason: "Auto-selected Shorts because source media is portrait.",
    };
  }

  if (probe.duration && probe.duration > 1 && probe.duration <= 75) {
    return {
      format: "shorts",
      reason: "Auto-selected Shorts because source media duration is short.",
    };
  }

  return {
    format: "landscape",
    reason: "Auto-selected landscape for longer or horizontal source media.",
  };
}

function resolutionForFormat(format: RenderFormat) {
  if (format === "shorts") {
    return { width: 1080, height: 1920, bodyDuration: DEFAULT_SHORTS_BODY };
  }

  return { width: 1920, height: 1080, bodyDuration: DEFAULT_LANDSCAPE_BODY };
}

async function createCardClip(params: {
  outputPath: string;
  width: number;
  height: number;
  duration: number;
  text: string;
  backgroundColor: string;
  textColor: string;
}) {
  const maxLineLength = params.height > params.width ? 22 : 34;
  const formattedText = wrapOverlayText(params.text, maxLineLength, 3);

  await withOverlayTextFile(
    {
      basePath: params.outputPath,
      suffix: "card",
      text: formattedText,
    },
    async (textFilePath) => {
      const drawtext = `drawtext=textfile='${escapeFilterValue(textFilePath)}':expansion=none:fontcolor=${
        params.textColor
      }:fontsize=${Math.round(params.height * 0.05)}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=${Math.round(
        params.height * 0.012,
      )}:fix_bounds=1:box=1:boxcolor=black@0.45:boxborderw=18`;

      await runBinary(FFMPEG_BIN, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${params.backgroundColor}:s=${params.width}x${params.height}:d=${params.duration}`,
        "-vf",
        drawtext,
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
    },
  );
}

async function createBodyClip(params: {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  duration: number;
  captionText: string;
  titleText: string;
  accentColor: string;
}) {
  const titleLineLength = params.height > params.width ? 22 : 34;
  const hookLineLength = params.height > params.width ? 24 : 40;
  const topText = wrapOverlayText(params.titleText, titleLineLength, 2);
  const bottomText = wrapOverlayText(params.captionText, hookLineLength, 3);
  const foregroundWidth = Math.round(params.width * (params.height > params.width ? 0.88 : 0.82));
  const foregroundHeight = Math.round(params.height * (params.height > params.width ? 0.36 : 0.72));
  const overlayYOffset = Math.round(params.height * 0.04);
  const titleFontSize = Math.round(params.height * (params.height > params.width ? 0.032 : 0.048));
  const captionFontSize = Math.round(params.height * (params.height > params.width ? 0.025 : 0.038));

  await withOverlayTextFile(
    {
      basePath: params.outputPath,
      suffix: "title",
      text: topText,
    },
    async (titleFilePath) =>
      withOverlayTextFile(
        {
          basePath: params.outputPath,
          suffix: "hook",
          text: bottomText,
        },
        async (hookFilePath) => {
          const filter = [
            `[0:v]scale=${params.width}:${params.height}:force_original_aspect_ratio=increase,crop=${params.width}:${params.height},boxblur=26:10[bg]`,
            `[0:v]scale=${foregroundWidth}:${foregroundHeight}:force_original_aspect_ratio=decrease[fg]`,
            `[bg][fg]overlay=(W-w)/2:((H-h)/2)-${overlayYOffset},drawtext=textfile='${escapeFilterValue(
              titleFilePath,
            )}':expansion=none:fontcolor=${params.accentColor}:fontsize=${titleFontSize}:x=(w-text_w)/2:y=${Math.round(
              params.height * 0.06,
            )}:line_spacing=${Math.round(params.height * 0.008)}:fix_bounds=1:box=1:boxcolor=black@0.35:boxborderw=18:enable='between(t,0,2.8)',drawtext=textfile='${escapeFilterValue(
              hookFilePath,
            )}':expansion=none:fontcolor=white:fontsize=${captionFontSize}:x=(w-text_w)/2:y=h-text_h-${Math.round(
              params.height * 0.12,
            )}:line_spacing=${Math.round(params.height * 0.007)}:fix_bounds=1:box=1:boxcolor=black@0.55:boxborderw=18:enable='between(t,0.3,${
              params.duration - 0.2
            })'`,
          ].join(";");

          const common = [
            "-y",
            "-t",
            String(params.duration),
            "-filter_complex",
            filter,
            "-r",
            "30",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            params.outputPath,
          ];

          if (isImage(params.inputPath)) {
            await runBinary(FFMPEG_BIN, ["-loop", "1", "-i", params.inputPath, ...common]);
            return;
          }

          await runBinary(FFMPEG_BIN, ["-i", params.inputPath, ...common]);
        },
      ),
  );
}

async function concatClips(clips: string[], outputPath: string) {
  const concatPath = `${outputPath}.txt`;
  const content = clips.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join("\n");

  await fs.writeFile(concatPath, content, "utf8");

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

  await fs.unlink(concatPath).catch(() => undefined);
}

export async function renderVideoVariants(params: {
  userId: string;
  jobId: string;
  mediaPaths: string[];
  title: string;
  hook: string;
  bulletOutline?: string[];
  cta: string;
  preference: RenderPreference;
}): Promise<RenderOutput> {
  if (!params.mediaPaths.length) {
    throw new Error("No media files were provided for rendering.");
  }

  await ensureFfmpegInstalled();

  const firstMedia = params.mediaPaths[0];
  const probe = await probeMedia(firstMedia);
  const picked = pickFormat(params.preference, probe);
  const { width, height, bodyDuration } = resolutionForFormat(picked.format);

  const outputDir = path.join(process.cwd(), "renders", params.userId, params.jobId);
  await ensureDir(outputDir);

  const variants = [] as RenderOutput["variants"];
  const bodySegments = buildBodySegments({
    hook: params.hook,
    bulletOutline: params.bulletOutline,
  });
  const effectiveSegments = bodySegments.length > 0 ? bodySegments : [params.hook];

  const effectiveBodyDuration = Math.max(
    picked.format === "shorts" ? 14 : 16,
    Math.min(bodyDuration, effectiveSegments.length * (picked.format === "shorts" ? 4 : 5)),
  );

  for (let index = 0; index < 3; index += 1) {
    const style = VARIANT_STYLES[index % VARIANT_STYLES.length];
    const variantIndex = index + 1;
    const tempDir = path.join(outputDir, `tmp-${variantIndex}`);

    await ensureDir(tempDir);

    const introPath = path.join(tempDir, `intro-${variantIndex}.mp4`);
    const outroPath = path.join(tempDir, `outro-${variantIndex}.mp4`);
    const finalPath = path.join(outputDir, `variant-${variantIndex}.mp4`);
    const bodyClipPaths: string[] = [];
    const baseSegmentDuration = Math.max(3, Math.floor(effectiveBodyDuration / effectiveSegments.length));

    await createCardClip({
      outputPath: introPath,
      width,
      height,
      duration: INTRO_DURATION,
      text: params.title,
      backgroundColor: style.introColor,
      textColor: style.accentColor,
    });

    let elapsedBodyDuration = 0;

    for (let segmentIndex = 0; segmentIndex < effectiveSegments.length; segmentIndex += 1) {
      const remainingDuration = effectiveBodyDuration - elapsedBodyDuration;
      const segmentDuration =
        segmentIndex === effectiveSegments.length - 1 ? remainingDuration : Math.min(baseSegmentDuration, remainingDuration);

      if (segmentDuration <= 0) {
        break;
      }

      const bodyPath = path.join(tempDir, `body-${variantIndex}-${segmentIndex + 1}.mp4`);

      await createBodyClip({
        inputPath: params.mediaPaths[segmentIndex % params.mediaPaths.length] ?? firstMedia,
        outputPath: bodyPath,
        width,
        height,
        duration: segmentDuration,
        captionText: effectiveSegments[segmentIndex] ?? params.hook,
        titleText: params.title,
        accentColor: style.accentColor,
      });

      bodyClipPaths.push(bodyPath);
      elapsedBodyDuration += segmentDuration;
    }

    await createCardClip({
      outputPath: outroPath,
      width,
      height,
      duration: OUTRO_DURATION,
      text: params.cta,
      backgroundColor: style.outroColor,
      textColor: "white",
    });

    await concatClips([introPath, ...bodyClipPaths, outroPath], finalPath);

    const duration = INTRO_DURATION + OUTRO_DURATION + elapsedBodyDuration;

    variants.push({
      variantIndex,
      path: finalPath,
      duration,
    });
  }

  return {
    format: picked.format,
    reason: picked.reason,
    variants,
  };
}

export const renderTestUtils = {
  escapeFilterValue,
  sanitizeOverlayText,
  wrapOverlayText,
  pickFormat,
  resolutionForFormat,
};
