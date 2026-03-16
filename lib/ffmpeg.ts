import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function resolveBundledBinary(relativePath: string[]) {
  const candidate = path.join(process.cwd(), "node_modules", ...relativePath);
  return existsSync(candidate) ? candidate : null;
}

export const FFMPEG_BIN =
  process.env.FFMPEG_PATH ??
  resolveBundledBinary(["ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"]) ??
  "ffmpeg";

export const FFPROBE_BIN =
  process.env.FFPROBE_PATH ??
  resolveBundledBinary([
    "ffprobe-static",
    "bin",
    process.platform,
    process.arch,
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  ]) ??
  "ffprobe";

export type ProbeResult = {
  width?: number;
  height?: number;
  duration?: number;
  hasAudio?: boolean;
};

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function isImagePath(inputPath: string) {
  return /\.(png|jpg|jpeg)$/i.test(inputPath);
}

export function isVideoPath(inputPath: string) {
  return /\.(mp4|mov)$/i.test(inputPath);
}

export async function runBinary(command: string, args: string[]) {
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

export async function ensureFfmpegInstalled() {
  await runBinary(FFMPEG_BIN, ["-version"]);
  await runBinary(FFPROBE_BIN, ["-version"]);
}

export async function probeMedia(inputPath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height:format=duration",
      "-of",
      "json",
      inputPath,
    ]);

    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };

    const stream = parsed.streams?.find((candidate) => candidate.width && candidate.height);

    return {
      width: stream?.width,
      height: stream?.height,
      duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
      hasAudio: parsed.streams?.some((candidate) => candidate.codec_type === "audio") ?? false,
    };
  } catch {
    return {};
  }
}
