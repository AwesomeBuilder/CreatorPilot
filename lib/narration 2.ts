import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDir, FFMPEG_BIN, probeMedia, runBinary } from "@/lib/ffmpeg";
import { llmGenerateSpeechDetailed } from "@/lib/llm";
import type { StoryboardPlan } from "@/lib/types";

const DEFAULT_SAMPLE_RATE = 24_000;

function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate: number) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const wavBuffer = Buffer.alloc(44 + pcmBuffer.length);

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}

function parseSampleRate(mimeType?: string | null) {
  const match = mimeType?.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : DEFAULT_SAMPLE_RATE;
}

function atempoFilterChain(speed: number) {
  const filters: string[] = [];
  let remaining = speed;

  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }

  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(",");
}

async function createSilenceSegment(outputPath: string, durationSeconds: number) {
  await runBinary(FFMPEG_BIN, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=${DEFAULT_SAMPLE_RATE}:cl=mono`,
    "-t",
    String(durationSeconds),
    "-c:a",
    "pcm_s16le",
    outputPath,
  ]);
}

async function fitSegmentToBeat(params: {
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
}) {
  const probe = await probeMedia(params.inputPath);
  const sourceDuration = Math.max(0.2, probe.duration ?? params.durationSeconds);
  const speed = sourceDuration > params.durationSeconds ? sourceDuration / params.durationSeconds : 1;
  const filters = [
    speed > 1.02 ? atempoFilterChain(Math.min(speed, 2.8)) : null,
    `apad=pad_dur=${params.durationSeconds}`,
    `atrim=0:${params.durationSeconds}`,
  ]
    .filter(Boolean)
    .join(",");

  await runBinary(FFMPEG_BIN, [
    "-y",
    "-i",
    params.inputPath,
    "-ar",
    String(DEFAULT_SAMPLE_RATE),
    "-ac",
    "1",
    "-filter:a",
    filters,
    "-c:a",
    "pcm_s16le",
    params.outputPath,
  ]);
}

async function concatAudioSegments(segmentPaths: string[], outputPath: string) {
  const concatPath = `${outputPath}.txt`;
  await fs.writeFile(concatPath, segmentPaths.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");

  try {
    await runBinary(FFMPEG_BIN, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c:a",
      "pcm_s16le",
      outputPath,
    ]);
  } finally {
    await fs.unlink(concatPath).catch(() => undefined);
  }
}

export async function buildNarrationTrack(params: {
  userId: string;
  jobId: string;
  storyboard: StoryboardPlan;
}) {
  const outputDir = path.join(process.cwd(), "renders", params.userId, params.jobId, "audio");
  await ensureDir(outputDir);

  const segmentPaths: string[] = [];
  const errors: string[] = [];
  let spokenSegmentCount = 0;

  for (const beat of params.storyboard.beats) {
    const rawSegmentPath = path.join(outputDir, `${beat.beatId}.raw.wav`);
    const fittedSegmentPath = path.join(outputDir, `${beat.beatId}.wav`);
    const narrationText = beat.narration.trim();

    if (!narrationText) {
      await createSilenceSegment(fittedSegmentPath, beat.durationSeconds);
      segmentPaths.push(fittedSegmentPath);
      continue;
    }

    const speech = await llmGenerateSpeechDetailed({
      text: narrationText,
    });

    if (!speech.pcmBase64) {
      errors.push(speech.error ?? `Narration generation failed for "${beat.title}".`);
      await createSilenceSegment(fittedSegmentPath, beat.durationSeconds);
      segmentPaths.push(fittedSegmentPath);
      continue;
    }

    const pcmBuffer = Buffer.from(speech.pcmBase64, "base64");
    const wavBuffer = pcmToWavBuffer(pcmBuffer, parseSampleRate(speech.mimeType));
    await fs.writeFile(rawSegmentPath, wavBuffer);
    await fitSegmentToBeat({
      inputPath: rawSegmentPath,
      outputPath: fittedSegmentPath,
      durationSeconds: beat.durationSeconds,
    });
    segmentPaths.push(fittedSegmentPath);
    spokenSegmentCount += 1;
  }

  if (spokenSegmentCount === 0) {
    return {
      path: null,
      error: errors[0] ?? "Generated narration was unavailable for every beat.",
      spokenSegmentCount,
    };
  }

  const narrationPath = path.join(outputDir, "narration.wav");
  await concatAudioSegments(segmentPaths, narrationPath);

  return {
    path: narrationPath,
    error: errors[0] ?? null,
    spokenSegmentCount,
  };
}
