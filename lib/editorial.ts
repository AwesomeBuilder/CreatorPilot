import type {
  RenderFormat,
  StoryboardBeat,
  StoryboardPlan,
  StoryboardSubtitleCue,
  StoryboardTitleOverlay,
} from "@/lib/types";

function roundSeconds(value: number) {
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeOverlayText(text: string, maxLength: number) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function wrapOverlayText(text: string, maxLineLength: number, maxLines: number) {
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

export function compactOverlayCopy(text: string, maxLength: number) {
  const normalized = sanitizeOverlayText(text, maxLength * 2);
  const firstClause = normalized.split(/[.:;!?]/)[0]?.trim() ?? normalized;
  if (firstClause.length <= maxLength) {
    return firstClause;
  }

  const shortened = firstClause.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${(lastSpace > 18 ? shortened.slice(0, lastSpace) : shortened).trim()}…`;
}

function subtitleChunkConfig(format: RenderFormat) {
  return format === "shorts"
    ? {
        idealWords: 4,
        maxWords: 6,
        maxChars: 44,
        cueCadenceSeconds: 1.2,
        maxCueCount: 3,
        leadInSeconds: 0.12,
        leadOutSeconds: 0.12,
        minCueDuration: 0.78,
      }
    : {
        idealWords: 5,
        maxWords: 8,
        maxChars: 68,
        cueCadenceSeconds: 1.28,
        maxCueCount: 4,
        leadInSeconds: 0.1,
        leadOutSeconds: 0.1,
        minCueDuration: 0.72,
      };
}

function splitCueTexts(params: { text: string; format: RenderFormat; durationSeconds: number }) {
  const config = subtitleChunkConfig(params.format);
  const words = sanitizeOverlayText(params.text, 320)
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const rawChunks: string[] = [];
  let currentWords: string[] = [];

  for (const word of words) {
    const nextWords = [...currentWords, word];
    const nextText = nextWords.join(" ");
    const shouldBreak =
      nextWords.length >= config.maxWords ||
      nextText.length >= config.maxChars ||
      (nextWords.length >= 2 && /[.!?;:]$/.test(word)) ||
      (nextWords.length >= config.idealWords && /,$/.test(word));

    if (shouldBreak) {
      rawChunks.push(nextText);
      currentWords = [];
    } else {
      currentWords = nextWords;
    }
  }

  if (currentWords.length > 0) {
    rawChunks.push(currentWords.join(" "));
  }

  const filteredChunks = rawChunks
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const maxCueCount = clamp(Math.round(params.durationSeconds / config.cueCadenceSeconds), 1, config.maxCueCount);
  const chunks = [...filteredChunks];

  while (chunks.length > maxCueCount) {
    let mergeIndex = 0;
    let smallestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < chunks.length - 1; index += 1) {
      const score = `${chunks[index]} ${chunks[index + 1]}`.length;
      if (score < smallestScore) {
        smallestScore = score;
        mergeIndex = index;
      }
    }

    chunks.splice(mergeIndex, 2, `${chunks[mergeIndex]} ${chunks[mergeIndex + 1]}`.trim());
  }

  while (chunks.length > 1 && chunks[chunks.length - 1]!.split(" ").length <= 1) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${tail}`.trim();
  }

  return chunks;
}

function distributeCueDurations(params: {
  cueTexts: string[];
  format: RenderFormat;
  durationSeconds: number;
}) {
  const config = subtitleChunkConfig(params.format);
  const available = Math.max(0.4, params.durationSeconds - config.leadInSeconds - config.leadOutSeconds);
  const minimumDuration = Math.min(config.minCueDuration, available / Math.max(1, params.cueTexts.length));
  const weights = params.cueTexts.map((cueText) => {
    const wordCount = cueText.split(/\s+/).filter(Boolean).length;
    return wordCount + (/[.!?]$/.test(cueText) ? 0.5 : 0.15);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  const durations = weights.map((weight) => (available * weight) / totalWeight);
  let deficit = 0;

  for (let index = 0; index < durations.length; index += 1) {
    if (durations[index]! >= minimumDuration) {
      continue;
    }

    deficit += minimumDuration - durations[index]!;
    durations[index] = minimumDuration;
  }

  if (deficit > 0) {
    const adjustable = durations
      .map((duration, index) => ({ duration, index }))
      .filter((entry) => entry.duration > minimumDuration);
    const adjustableTotal = adjustable.reduce((sum, entry) => sum + (entry.duration - minimumDuration), 0);

    if (adjustableTotal > 0) {
      for (const entry of adjustable) {
        const availableReduction = entry.duration - minimumDuration;
        const reduction = Math.min(availableReduction, (availableReduction / adjustableTotal) * deficit);
        durations[entry.index] = Math.max(minimumDuration, entry.duration - reduction);
      }
    }
  }

  const assigned = durations.reduce((sum, duration) => sum + duration, 0);
  const drift = available - assigned;
  durations[durations.length - 1] = Math.max(minimumDuration, (durations[durations.length - 1] ?? minimumDuration) + drift);

  return durations.map((duration) => roundSeconds(duration));
}

export function buildBeatSubtitleCues(params: {
  beat: StoryboardBeat;
  format: RenderFormat;
  timelineStartSeconds: number;
}) {
  const cueTexts = splitCueTexts({
    text: params.beat.narration || params.beat.caption || params.beat.title,
    format: params.format,
    durationSeconds: params.beat.durationSeconds,
  });

  if (cueTexts.length === 0) {
    return [] satisfies StoryboardSubtitleCue[];
  }

  const config = subtitleChunkConfig(params.format);
  const cueDurations = distributeCueDurations({
    cueTexts,
    format: params.format,
    durationSeconds: params.beat.durationSeconds,
  });

  let currentOffset = config.leadInSeconds;
  return cueTexts.map((text, index) => {
    const startOffsetSeconds = roundSeconds(currentOffset);
    const endOffsetSeconds =
      index === cueTexts.length - 1
        ? roundSeconds(Math.max(startOffsetSeconds + 0.28, params.beat.durationSeconds - config.leadOutSeconds))
        : roundSeconds(Math.min(params.beat.durationSeconds - config.leadOutSeconds, startOffsetSeconds + (cueDurations[index] ?? 0)));

    currentOffset = endOffsetSeconds;

    return {
      cueId: `${params.beat.beatId}:cue-${index + 1}`,
      beatId: params.beat.beatId,
      text,
      startSeconds: roundSeconds(params.timelineStartSeconds + startOffsetSeconds),
      endSeconds: roundSeconds(params.timelineStartSeconds + endOffsetSeconds),
      startOffsetSeconds,
      endOffsetSeconds,
    };
  });
}

export function buildBeatTitleOverlay(params: {
  beat: StoryboardBeat;
  format: RenderFormat;
  timelineStartSeconds: number;
}) {
  const maxDuration = params.format === "shorts" ? 1.05 : 1.16;
  const startOffsetSeconds = params.format === "shorts" ? 0.08 : 0.06;
  const endOffsetSeconds = roundSeconds(
    Math.min(params.beat.durationSeconds - 0.18, Math.min(maxDuration, Math.max(startOffsetSeconds + 0.58, params.beat.durationSeconds * 0.34))),
  );

  return {
    beatId: params.beat.beatId,
    label: params.beat.purpose.toUpperCase(),
    text: compactOverlayCopy(params.beat.title || params.beat.caption || params.beat.narration, params.format === "shorts" ? 44 : 56),
    startSeconds: roundSeconds(params.timelineStartSeconds + startOffsetSeconds),
    endSeconds: roundSeconds(params.timelineStartSeconds + endOffsetSeconds),
    startOffsetSeconds: roundSeconds(startOffsetSeconds),
    endOffsetSeconds,
  } satisfies StoryboardTitleOverlay;
}

export function applyStoryboardEditorialTiming(plan: StoryboardPlan): StoryboardPlan {
  let timelineStartSeconds = 0;
  const beats = plan.beats.map((beat) => {
    const beatStartSeconds = roundSeconds(timelineStartSeconds);
    const beatEndSeconds = roundSeconds(beatStartSeconds + beat.durationSeconds);
    const titleOverlay = buildBeatTitleOverlay({
      beat,
      format: plan.format,
      timelineStartSeconds: beatStartSeconds,
    });
    const subtitleCues = buildBeatSubtitleCues({
      beat,
      format: plan.format,
      timelineStartSeconds: beatStartSeconds,
    });

    timelineStartSeconds = beatEndSeconds;

    return {
      ...beat,
      timelineStartSeconds: beatStartSeconds,
      timelineEndSeconds: beatEndSeconds,
      titleOverlay,
      subtitleCues,
    };
  });

  return {
    ...plan,
    durationSeconds: roundSeconds(beats.reduce((sum, beat) => sum + beat.durationSeconds, 0)),
    beats,
    subtitleCues: beats.flatMap((beat) => beat.subtitleCues ?? []),
  };
}

export function formatSecondsLabel(value?: number) {
  if (typeof value !== "number") {
    return null;
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  const tenths = Math.floor((value % 1) * 10);

  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export const editorialTestUtils = {
  splitCueTexts,
  distributeCueDurations,
};
