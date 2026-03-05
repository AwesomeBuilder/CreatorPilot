import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { RenderFormat, RenderOutput, RenderPreference } from "@/lib/types";

const execFileAsync = promisify(execFile);

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

function escapeDrawtext(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, " ")
    .slice(0, 180);
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function runBinary(command: string, args: string[]) {
  await execFileAsync(command, args, {
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function ensureFfmpegInstalled() {
  await runBinary("ffmpeg", ["-version"]);
  await runBinary("ffprobe", ["-version"]);
}

function isImage(inputPath: string) {
  return /\.(png|jpg|jpeg)$/i.test(inputPath);
}

async function probeMedia(inputPath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
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

  if (probe.duration && probe.duration <= 75) {
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
  const drawtext = `drawtext=text='${escapeDrawtext(params.text)}':fontcolor=${params.textColor}:fontsize=${Math.round(
    params.height * 0.05,
  )}:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.45:boxborderw=18`;

  await runBinary("ffmpeg", [
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
}

async function createBodyClip(params: {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  duration: number;
  hookText: string;
  titleText: string;
  accentColor: string;
}) {
  const topText = escapeDrawtext(params.titleText);
  const bottomText = escapeDrawtext(params.hookText);

  const filter = [
    `scale=${params.width}:${params.height}:force_original_aspect_ratio=decrease`,
    `pad=${params.width}:${params.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `drawtext=text='${topText}':fontcolor=${params.accentColor}:fontsize=${Math.round(
      params.height * 0.035,
    )}:x=(w-text_w)/2:y=${Math.round(params.height * 0.06)}:box=1:boxcolor=black@0.5:boxborderw=12:enable='between(t,0,6)'`,
    `drawtext=text='${bottomText}':fontcolor=white:fontsize=${Math.round(
      params.height * 0.03,
    )}:x=(w-text_w)/2:y=h-${Math.round(params.height * 0.14)}:box=1:boxcolor=black@0.6:boxborderw=10:enable='between(t,1,12)'`,
  ].join(",");

  const common = [
    "-y",
    "-t",
    String(params.duration),
    "-vf",
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
    await runBinary("ffmpeg", ["-loop", "1", "-i", params.inputPath, ...common]);
    return;
  }

  await runBinary("ffmpeg", ["-i", params.inputPath, ...common]);
}

async function concatClips(clips: string[], outputPath: string) {
  const concatPath = `${outputPath}.txt`;
  const content = clips.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join("\n");

  await fs.writeFile(concatPath, content, "utf8");

  await runBinary("ffmpeg", [
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

  const effectiveBodyDuration = Math.max(
    12,
    Math.min(
      bodyDuration,
      probe.duration && Number.isFinite(probe.duration) ? Math.floor(probe.duration) : bodyDuration,
    ),
  );

  for (let index = 0; index < 3; index += 1) {
    const style = VARIANT_STYLES[index % VARIANT_STYLES.length];
    const variantIndex = index + 1;
    const tempDir = path.join(outputDir, `tmp-${variantIndex}`);

    await ensureDir(tempDir);

    const introPath = path.join(tempDir, `intro-${variantIndex}.mp4`);
    const bodyPath = path.join(tempDir, `body-${variantIndex}.mp4`);
    const outroPath = path.join(tempDir, `outro-${variantIndex}.mp4`);
    const finalPath = path.join(outputDir, `variant-${variantIndex}.mp4`);

    await createCardClip({
      outputPath: introPath,
      width,
      height,
      duration: INTRO_DURATION,
      text: params.title,
      backgroundColor: style.introColor,
      textColor: style.accentColor,
    });

    await createBodyClip({
      inputPath: firstMedia,
      outputPath: bodyPath,
      width,
      height,
      duration: effectiveBodyDuration,
      hookText: params.hook,
      titleText: params.title,
      accentColor: style.accentColor,
    });

    await createCardClip({
      outputPath: outroPath,
      width,
      height,
      duration: OUTRO_DURATION,
      text: params.cta,
      backgroundColor: style.outroColor,
      textColor: "white",
    });

    await concatClips([introPath, bodyPath, outroPath], finalPath);

    const duration = INTRO_DURATION + OUTRO_DURATION + effectiveBodyDuration;

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
