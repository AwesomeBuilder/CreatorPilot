import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { applyStoryboardEditorialTiming } from "@/lib/editorial";
import { ensureDir, FFMPEG_BIN, probeMedia, runBinary } from "@/lib/ffmpeg";
import { llmGenerateSpeechDetailed } from "@/lib/llm";
import type { RenderAudioComposition, StoryboardPlan, StoryboardSubtitleCue } from "@/lib/types";

const DEFAULT_SAMPLE_RATE = 24_000;
const AUDIO_FILE_PATTERN = /\.(mp3|wav|m4a|aac|aif|aiff|flac|ogg)$/i;

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

function roundSeconds(value: number) {
  return Number(value.toFixed(2));
}

function resolveNumericEnv(name: string, fallback: number) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function narrationSegmentDuration(params: {
  sourceDuration?: number;
  minimumDuration: number;
}) {
  const sourceDuration = Math.max(0.2, params.sourceDuration ?? params.minimumDuration);
  if (sourceDuration <= params.minimumDuration) {
    return roundSeconds(params.minimumDuration);
  }

  return roundSeconds(sourceDuration + 0.12);
}

async function renderSegmentAtDuration(params: {
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
}) {
  await runBinary(FFMPEG_BIN, [
    "-y",
    "-i",
    params.inputPath,
    "-ar",
    String(DEFAULT_SAMPLE_RATE),
    "-ac",
    "1",
    "-filter:a",
    [`apad=pad_dur=${params.durationSeconds}`, `atrim=0:${params.durationSeconds}`].join(","),
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

async function resolveConfiguredAudioAsset(rawPath?: string | null) {
  if (!rawPath) {
    return null;
  }

  const resolvedPath = path.resolve(rawPath);
  if (!existsSync(resolvedPath)) {
    return null;
  }

  const stat = await fs.stat(resolvedPath);
  if (stat.isFile()) {
    return AUDIO_FILE_PATTERN.test(resolvedPath) ? resolvedPath : null;
  }

  if (!stat.isDirectory()) {
    return null;
  }

  const entries = await fs.readdir(resolvedPath);
  const selected = entries
    .filter((entry) => AUDIO_FILE_PATTERN.test(entry))
    .sort((left, right) => left.localeCompare(right))[0];

  return selected ? path.join(resolvedPath, selected) : null;
}

async function loopAudioToDuration(params: {
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
}) {
  await runBinary(FFMPEG_BIN, [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    params.inputPath,
    "-t",
    String(params.durationSeconds),
    "-ar",
    String(DEFAULT_SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    params.outputPath,
  ]);
}

async function mixNarrationWithMusic(params: {
  narrationPath: string;
  musicPath: string;
  outputPath: string;
  totalDuration: number;
  musicGainDb: number;
  duckingDb: number;
}) {
  const threshold = 0.02;
  const ratio = Math.max(4, Math.min(20, Number((params.duckingDb / 1.4).toFixed(2))));
  const attack = 20;
  const release = 280;

  await runBinary(FFMPEG_BIN, [
    "-y",
    "-i",
    params.musicPath,
    "-i",
    params.narrationPath,
    "-filter_complex",
    [
      `[0:a]volume=${params.musicGainDb}dB[musicbed]`,
      `[musicbed][1:a]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}[ducked]`,
      `[ducked][1:a]amix=inputs=2:weights=1 1:normalize=0:dropout_transition=0,atrim=0:${params.totalDuration}[mix]`,
    ].join(";"),
    "-map",
    "[mix]",
    "-ar",
    String(DEFAULT_SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    params.outputPath,
  ]);
}

async function buildTransitionSfxTrack(params: {
  sfxPath: string;
  outputPath: string;
  eventTimes: number[];
  totalDuration: number;
  gainDb: number;
}) {
  const eventFilters = params.eventTimes.map((eventTime, index) => {
    const delayMs = Math.max(0, Math.round(eventTime * 1000));
    return `[0:a]atrim=0:0.44,afade=t=in:st=0:d=0.03,afade=t=out:st=0.29:d=0.15,volume=${params.gainDb}dB,adelay=${delayMs}[sfx${index}]`;
  });

  const mixInputs = ["[base]", ...params.eventTimes.map((_, index) => `[sfx${index}]`)].join("");

  await runBinary(FFMPEG_BIN, [
    "-y",
    "-i",
    params.sfxPath,
    "-filter_complex",
    [`anullsrc=r=${DEFAULT_SAMPLE_RATE}:cl=mono:d=${params.totalDuration}[base]`, ...eventFilters, `${mixInputs}amix=inputs=${params.eventTimes.length + 1}:normalize=0:dropout_transition=0[sfxmix]`].join(";"),
    "-map",
    "[sfxmix]",
    "-ar",
    String(DEFAULT_SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    params.outputPath,
  ]);
}

async function mixTransitionSfx(params: {
  inputPath: string;
  sfxTrackPath: string;
  outputPath: string;
  totalDuration: number;
}) {
  await runBinary(FFMPEG_BIN, [
    "-y",
    "-i",
    params.inputPath,
    "-i",
    params.sfxTrackPath,
    "-filter_complex",
    `[0:a][1:a]amix=inputs=2:weights=1 1:normalize=0:dropout_transition=0,atrim=0:${params.totalDuration}[mix]`,
    "-map",
    "[mix]",
    "-ar",
    String(DEFAULT_SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    params.outputPath,
  ]);
}

function summarizeAudioComposition(composition: RenderAudioComposition) {
  const summaryParts = [`Narration ${composition.narration.spokenSegmentCount}/${composition.narration.beatCount} beat${composition.narration.beatCount === 1 ? "" : "s"} voiced.`];

  if (composition.backgroundMusic.status === "mixed") {
    summaryParts.push(`Music mixed at ${composition.backgroundMusic.gainDb} dB and ducked by ${composition.backgroundMusic.duckingDb} dB.`);
  } else if (composition.backgroundMusic.status === "unavailable") {
    summaryParts.push(`Music unavailable: ${composition.backgroundMusic.error}`);
  } else if (composition.backgroundMusic.status === "disabled") {
    summaryParts.push("Music disabled.");
  }

  if (composition.transitionSfx.status === "mixed") {
    summaryParts.push(`Transition SFX applied at ${composition.transitionSfx.eventCount} ${composition.transitionSfx.eventCount === 1 ? "boundary" : "boundaries"}.`);
  } else if (composition.transitionSfx.status === "unavailable") {
    summaryParts.push(`Transition SFX unavailable: ${composition.transitionSfx.error}`);
  } else if (composition.transitionSfx.status === "disabled") {
    summaryParts.push("Transition SFX disabled.");
  }

  return summaryParts.join(" ");
}

function narrationGenerationEnabled() {
  return process.env.RENDER_ENABLE_GENERATED_NARRATION !== "false";
}

export async function buildNarrationTrack(params: {
  userId: string;
  jobId: string;
  storyboard: StoryboardPlan;
  onProgress?: (message: string) => Promise<void>;
}) {
  const storyboard = applyStoryboardEditorialTiming(params.storyboard);

  if (!narrationGenerationEnabled()) {
    const composition: RenderAudioComposition = {
      summary: "",
      narration: {
        status: "disabled",
        spokenSegmentCount: 0,
        beatCount: storyboard.beats.length,
        cueCount: 0,
        modelUsed: null,
        error: "Generated narration is disabled by RENDER_ENABLE_GENERATED_NARRATION.",
      },
      backgroundMusic: {
        status: "disabled",
        sourcePath: null,
        gainDb: resolveNumericEnv("RENDER_BACKGROUND_MUSIC_GAIN_DB", -22),
        duckingDb: resolveNumericEnv("RENDER_BACKGROUND_MUSIC_DUCK_DB", 14),
        error: null,
      },
      transitionSfx: {
        status: "disabled",
        sourcePath: null,
        eventCount: 0,
        gainDb: resolveNumericEnv("RENDER_TRANSITION_SFX_GAIN_DB", -18),
        error: null,
      },
    };
    composition.summary = summarizeAudioComposition(composition);

    return {
      path: null,
      narrationPath: null,
      error: "Generated narration is disabled by RENDER_ENABLE_GENERATED_NARRATION.",
      spokenSegmentCount: 0,
      subtitleCues: [],
      storyboard,
      modelUsed: null,
      audioComposition: composition,
    };
  }

  const outputDir = path.join(process.cwd(), "renders", params.userId, params.jobId, "audio");
  await ensureDir(outputDir);

  const segmentPaths: string[] = [];
  const errors: string[] = [];
  const modelUsed: string[] = [];
  const beatDurations = new Map<string, number>();
  const spokenBeatIds = new Set<string>();
  let spokenSegmentCount = 0;

  for (const beat of storyboard.beats) {
    const rawSegmentPath = path.join(outputDir, `${beat.beatId}.raw.wav`);
    const fittedSegmentPath = path.join(outputDir, `${beat.beatId}.wav`);
    const narrationText = beat.narration.trim();
    await params.onProgress?.(`Narration beat ${beat.order}/${storyboard.beats.length}: ${beat.title}`);

    if (!narrationText) {
      await createSilenceSegment(fittedSegmentPath, beat.durationSeconds);
      segmentPaths.push(fittedSegmentPath);
      beatDurations.set(beat.beatId, beat.durationSeconds);
      continue;
    }

    const speech = await llmGenerateSpeechDetailed({
      text: narrationText,
    });

    if (!speech.pcmBase64) {
      errors.push(speech.error ?? `Narration generation failed for "${beat.title}".`);
      await createSilenceSegment(fittedSegmentPath, beat.durationSeconds);
      segmentPaths.push(fittedSegmentPath);
      beatDurations.set(beat.beatId, beat.durationSeconds);
      continue;
    }

    const pcmBuffer = Buffer.from(speech.pcmBase64, "base64");
    const wavBuffer = pcmToWavBuffer(pcmBuffer, parseSampleRate(speech.mimeType));
    await fs.writeFile(rawSegmentPath, wavBuffer);
    const rawSegmentProbe = await probeMedia(rawSegmentPath);
    const adjustedDuration = narrationSegmentDuration({
      sourceDuration: rawSegmentProbe.duration,
      minimumDuration: beat.durationSeconds,
    });
    await renderSegmentAtDuration({
      inputPath: rawSegmentPath,
      outputPath: fittedSegmentPath,
      durationSeconds: adjustedDuration,
    });
    segmentPaths.push(fittedSegmentPath);
    beatDurations.set(beat.beatId, adjustedDuration);
    if (speech.modelUsed) {
      modelUsed.push(speech.modelUsed);
    }
    spokenBeatIds.add(beat.beatId);
    spokenSegmentCount += 1;
  }

  const adjustedStoryboard = applyStoryboardEditorialTiming({
    ...storyboard,
    beats: storyboard.beats.map((beat) => ({
      ...beat,
      durationSeconds: beatDurations.get(beat.beatId) ?? beat.durationSeconds,
    })),
  });

  const subtitleCues: StoryboardSubtitleCue[] = adjustedStoryboard.beats
    .filter((beat) => spokenBeatIds.has(beat.beatId))
    .flatMap((beat) => beat.subtitleCues ?? []);

  const backgroundMusicConfigured = Boolean(process.env.RENDER_BACKGROUND_MUSIC_PATH);
  const backgroundMusicSourcePath = await resolveConfiguredAudioAsset(process.env.RENDER_BACKGROUND_MUSIC_PATH);
  const transitionSfxConfigured = Boolean(process.env.RENDER_TRANSITION_SFX_PATH);
  const transitionSfxSourcePath = await resolveConfiguredAudioAsset(process.env.RENDER_TRANSITION_SFX_PATH);
  const musicGainDb = resolveNumericEnv("RENDER_BACKGROUND_MUSIC_GAIN_DB", -22);
  const duckingDb = resolveNumericEnv("RENDER_BACKGROUND_MUSIC_DUCK_DB", 14);
  const transitionSfxGainDb = resolveNumericEnv("RENDER_TRANSITION_SFX_GAIN_DB", -18);
  const transitionSfxEnabled = process.env.RENDER_ENABLE_TRANSITION_SFX === "true";

  if (spokenSegmentCount === 0) {
    const composition: RenderAudioComposition = {
      summary: "",
      narration: {
        status: "missing",
        spokenSegmentCount,
        beatCount: storyboard.beats.length,
        cueCount: 0,
        modelUsed: null,
        error: errors[0] ?? "Generated narration was unavailable for every beat.",
      },
      backgroundMusic: {
        status: backgroundMusicSourcePath ? "skipped" : backgroundMusicConfigured ? "unavailable" : "disabled",
        sourcePath: backgroundMusicSourcePath,
        gainDb: musicGainDb,
        duckingDb,
        error: backgroundMusicSourcePath
          ? "Music is skipped when narration is missing so upload gating stays intact."
          : backgroundMusicConfigured
            ? "RENDER_BACKGROUND_MUSIC_PATH is missing or invalid."
            : null,
      },
      transitionSfx: {
        status: transitionSfxEnabled ? (transitionSfxSourcePath ? "skipped" : transitionSfxConfigured ? "unavailable" : "disabled") : "disabled",
        sourcePath: transitionSfxSourcePath,
        eventCount: 0,
        gainDb: transitionSfxGainDb,
        error: transitionSfxEnabled
          ? transitionSfxSourcePath
            ? "Transition SFX are skipped when narration is missing."
            : transitionSfxConfigured
              ? "RENDER_TRANSITION_SFX_PATH is missing or invalid."
              : null
          : null,
      },
    };
    composition.summary = summarizeAudioComposition(composition);

    return {
      path: null,
      narrationPath: null,
      error: errors[0] ?? "Generated narration was unavailable for every beat.",
      spokenSegmentCount,
      subtitleCues: [],
      storyboard: adjustedStoryboard,
      modelUsed: null,
      audioComposition: composition,
    };
  }

  const narrationPath = path.join(outputDir, "narration.wav");
  await concatAudioSegments(segmentPaths, narrationPath);
  await params.onProgress?.("Narration track assembled.");

  let finalAudioPath = narrationPath;
  const composition: RenderAudioComposition = {
    summary: "",
    narration: {
      status: "generated",
      spokenSegmentCount,
      beatCount: adjustedStoryboard.beats.length,
      cueCount: subtitleCues.length,
      modelUsed: modelUsed[0] ?? null,
      error: errors[0] ?? null,
    },
    backgroundMusic: {
      status: backgroundMusicConfigured && !backgroundMusicSourcePath ? "unavailable" : "disabled",
      sourcePath: backgroundMusicSourcePath,
      gainDb: musicGainDb,
      duckingDb,
      error: backgroundMusicConfigured && !backgroundMusicSourcePath ? "RENDER_BACKGROUND_MUSIC_PATH is missing or invalid." : null,
    },
    transitionSfx: {
      status: transitionSfxEnabled ? (transitionSfxSourcePath ? "unavailable" : transitionSfxConfigured ? "unavailable" : "disabled") : "disabled",
      sourcePath: transitionSfxSourcePath,
      eventCount: 0,
      gainDb: transitionSfxGainDb,
      error: transitionSfxEnabled && !transitionSfxSourcePath ? "RENDER_TRANSITION_SFX_PATH is missing or invalid." : null,
    },
  };

  const totalDuration = adjustedStoryboard.durationSeconds ?? adjustedStoryboard.beats.reduce((sum, beat) => sum + beat.durationSeconds, 0);

  if (backgroundMusicSourcePath) {
    const loopedMusicPath = path.join(outputDir, "background-music.loop.wav");
    const mixedMusicPath = path.join(outputDir, "mix-with-music.wav");

    try {
      await loopAudioToDuration({
        inputPath: backgroundMusicSourcePath,
        outputPath: loopedMusicPath,
        durationSeconds: totalDuration,
      });
      await mixNarrationWithMusic({
        narrationPath,
        musicPath: loopedMusicPath,
        outputPath: mixedMusicPath,
        totalDuration,
        musicGainDb,
        duckingDb,
      });
      finalAudioPath = mixedMusicPath;
      composition.backgroundMusic.status = "mixed";
      await params.onProgress?.("Background music mixed into narration.");
    } catch (error) {
      composition.backgroundMusic.status = "unavailable";
      composition.backgroundMusic.error =
        error instanceof Error ? error.message : "Background music could not be mixed into the narration track.";
    }
  }

  if (!backgroundMusicSourcePath && !backgroundMusicConfigured) {
    composition.backgroundMusic.status = "disabled";
    composition.backgroundMusic.error = null;
  }

  if (transitionSfxEnabled && transitionSfxSourcePath) {
    const eventTimes = adjustedStoryboard.beats
      .slice(0, -1)
      .map((beat) => Math.max(0, (beat.timelineEndSeconds ?? 0) - 0.12))
      .filter((eventTime) => Number.isFinite(eventTime));

    if (eventTimes.length > 0) {
      const sfxTrackPath = path.join(outputDir, "transition-sfx.wav");
      const mixedWithSfxPath = path.join(outputDir, "mix-with-sfx.wav");

      try {
        await buildTransitionSfxTrack({
          sfxPath: transitionSfxSourcePath,
          outputPath: sfxTrackPath,
          eventTimes,
          totalDuration,
          gainDb: transitionSfxGainDb,
        });
        await mixTransitionSfx({
          inputPath: finalAudioPath,
          sfxTrackPath,
          outputPath: mixedWithSfxPath,
          totalDuration,
        });
        finalAudioPath = mixedWithSfxPath;
        composition.transitionSfx.status = "mixed";
        composition.transitionSfx.eventCount = eventTimes.length;
        composition.transitionSfx.error = null;
        await params.onProgress?.("Transition SFX layered onto narration.");
      } catch (error) {
        composition.transitionSfx.status = "unavailable";
        composition.transitionSfx.error =
          error instanceof Error ? error.message : "Transition SFX could not be layered onto the audio mix.";
      }
    } else {
      composition.transitionSfx.status = "skipped";
      composition.transitionSfx.error = "No beat boundaries were available for transition SFX.";
    }
  }

  composition.summary = summarizeAudioComposition(composition);

  return {
    path: finalAudioPath,
    narrationPath,
    error: errors[0] ?? null,
    spokenSegmentCount,
    subtitleCues,
    storyboard: adjustedStoryboard,
    modelUsed: modelUsed[0] ?? null,
    audioComposition: composition,
  };
}
