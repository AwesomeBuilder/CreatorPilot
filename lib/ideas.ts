import path from "node:path";

import { llmChatJSON } from "@/lib/llm";
import { buildStoryboardPlan } from "@/lib/storyboard";
import type { Idea, IdeaContextAssessment, IdeaGenerationMode, IdeaGenerationResult, Trend } from "@/lib/types";

type UploadedMediaAsset = {
  id?: string;
  path: string;
  type: "image" | "video";
};

type TrendIdeaParams = {
  workflow?: "trend";
  trend: Trend;
  niche?: string | null;
  tone?: string | null;
  mediaAssets?: UploadedMediaAsset[];
  creatorMemorySummary?: string | null;
};

type MediaLedIdeaParams = {
  workflow: "media-led";
  brief?: string | null;
  niche?: string | null;
  tone?: string | null;
  mediaAssets: UploadedMediaAsset[];
  creatorMemorySummary?: string | null;
};

type IdeaGenerationParams = TrendIdeaParams | MediaLedIdeaParams;

type IdeaMediaContext = {
  assetCount: number;
  summary: string;
  assetNotes: Array<{
    label: string;
    type: "image" | "video";
    summary: string;
    topCues: string[];
  }>;
  recommendedUploads: string[];
  coverageScore?: number;
  topSignals: string[];
};

type PartialTrendLike = Partial<Trend> | null | undefined;

type MediaLedLlmResult = {
  ideas?: Idea[];
  generationMode?: IdeaGenerationMode;
  contextAssessment?: Partial<IdeaContextAssessment>;
  derivedContextTrend?: PartialTrendLike;
};

const MEDIA_LED_MISSING_PROMPTS = [
  "What is this about?",
  "How does it work?",
  "What should the audience understand or do next?",
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanBrief(brief?: string | null) {
  return brief?.replace(/\s+/g, " ").trim() ?? "";
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compactText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizePromptList(values?: string[]) {
  const prompts = dedupe((values ?? []).map((value) => compactText(value, 120)));
  return prompts.length > 0 ? prompts.slice(0, 4) : [...MEDIA_LED_MISSING_PROMPTS];
}

function titleCaseToken(value: string) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function firstSentence(value: string) {
  return value.split(/[.!?]\s/)[0]?.trim() ?? value.trim();
}

function titleFromText(value: string, fallback: string) {
  const sentence = compactText(firstSentence(value), 72);
  return sentence.length > 0 ? sentence : fallback;
}

function uniqueSignals(context?: IdeaMediaContext | null) {
  return dedupe([...(context?.topSignals ?? []), ...(context?.assetNotes ?? []).flatMap((asset) => asset.topCues)]).slice(0, 8);
}

function fallbackMediaContext(assets: UploadedMediaAsset[]): IdeaMediaContext {
  const imageCount = assets.filter((asset) => asset.type === "image").length;
  const videoCount = assets.length - imageCount;

  return {
    assetCount: assets.length,
    summary: `The creator has ${assets.length} uploaded asset${assets.length === 1 ? "" : "s"} available (${videoCount} video${
      videoCount === 1 ? "" : "s"
    }, ${imageCount} image${imageCount === 1 ? "" : "s"}). Prefer ideas that can be illustrated with those existing uploads.`,
    assetNotes: assets.slice(0, 4).map((asset) => ({
      label: path.basename(asset.path),
      type: asset.type,
      summary: `Uploaded ${asset.type}: ${path.basename(asset.path)}`,
      topCues: [],
    })),
    recommendedUploads: [],
    coverageScore: assets.length > 1 ? 58 : 44,
    topSignals: [],
  };
}

async function buildIdeaMediaContext(params: {
  trend: Trend;
  assets: UploadedMediaAsset[];
}): Promise<IdeaMediaContext | null> {
  if (params.assets.length === 0) {
    return null;
  }

  try {
    const seedIdea: Idea = {
      videoTitle: `${params.trend.trendTitle}: creator breakdown`,
      hook: "Generate ideas that can be directly illustrated with the uploaded media.",
      bulletOutline: [
        params.trend.summary || `What is changing around ${params.trend.trendTitle}`,
        "Which uploaded visuals already support this topic",
        "What creator takeaway can be shown clearly with the existing media",
      ],
      cta: "Invite audience reaction.",
    };

    const plan = await buildStoryboardPlan({
      trend: params.trend,
      idea: seedIdea,
      assets: params.assets.map((asset, index) => ({
        id: asset.id ?? `idea-media-${index + 1}`,
        path: asset.path,
        type: asset.type,
      })),
      preference: "auto",
    });

    const topSignals = dedupe(plan.assetSummaries.flatMap((asset) => asset.topCues)).slice(0, 8);

    return {
      assetCount: params.assets.length,
      summary: plan.coverageSummary,
      assetNotes: plan.assetSummaries.slice(0, 4).map((asset) => ({
        label: path.basename(asset.assetPath),
        type: asset.type,
        summary: asset.compactSummary,
        topCues: asset.topCues.slice(0, 4),
      })),
      recommendedUploads: plan.recommendedUploads?.slice(0, 4) ?? [],
      coverageScore: plan.coverageScore,
      topSignals,
    };
  } catch {
    return fallbackMediaContext(params.assets);
  }
}

async function buildMediaLedContext(params: {
  assets: UploadedMediaAsset[];
  brief?: string | null;
}): Promise<IdeaMediaContext | null> {
  const brief = cleanBrief(params.brief);
  const explorationTrend: Trend = {
    trendTitle: brief ? titleFromText(brief, "Media-led explainer") : "Media-led explainer",
    summary:
      brief || "Creator-supplied screenshots and clips. Find the clearest story the media already supports and explain it clearly.",
    links: [],
    fitLabel: "Open feed",
    fitReason: "Derived from uploaded creator media.",
  };

  return buildIdeaMediaContext({
    trend: explorationTrend,
    assets: params.assets,
  });
}

function buildTrendAssessment(mediaContext?: IdeaMediaContext | null): IdeaContextAssessment {
  return {
    summary: mediaContext?.summary ?? "Using the selected trend as the primary source of context.",
    confidence: clamp(mediaContext?.coverageScore ?? 88, 55, 100),
    requiresBrief: false,
    missingContextPrompts: [],
  };
}

function buildFallbackDerivedTrend(params: {
  brief?: string | null;
  mediaContext?: IdeaMediaContext | null;
}): Trend {
  const brief = cleanBrief(params.brief);
  const signals = uniqueSignals(params.mediaContext);
  const leadAsset = params.mediaContext?.assetNotes[0]?.label ?? "uploaded media";
  const signalTitle =
    signals.length > 0 ? `${signals.slice(0, 3).map((signal) => titleCaseToken(signal)).join(" / ")} explainer` : null;

  return {
    trendTitle: brief ? titleFromText(brief, signalTitle ?? "Media-led explainer") : signalTitle ?? `Explainer from ${leadAsset}`,
    summary:
      brief ||
      params.mediaContext?.summary ||
      "Creator-supplied screenshots and clips for a structured explainer or narrative video.",
    links: [],
    fitLabel: "Open feed",
    fitReason: "Derived from uploaded creator media and optional text context.",
  };
}

function buildMediaLedAssessment(params: {
  mediaContext?: IdeaMediaContext | null;
  brief?: string | null;
}): IdeaContextAssessment {
  const brief = cleanBrief(params.brief);
  const mediaContext = params.mediaContext;
  const signals = uniqueSignals(mediaContext);
  const noteCount = mediaContext?.assetNotes.filter((asset) => asset.summary.trim().length > 0).length ?? 0;

  let confidence = 28;
  confidence += Math.min(30, signals.length * 8);
  confidence += Math.min(18, noteCount * 5);
  confidence += Math.min(10, (mediaContext?.assetCount ?? 0) * 4);
  confidence += Math.min(18, Math.floor(brief.length / 18));
  confidence += Math.round((mediaContext?.coverageScore ?? 0) * 0.18);
  if ((mediaContext?.recommendedUploads.length ?? 0) === 0 && (mediaContext?.assetCount ?? 0) > 0) {
    confidence += 4;
  }

  const normalizedConfidence = clamp(confidence, 10, 100);
  const requiresBrief = brief.length === 0 && (normalizedConfidence < 58 || signals.length < 2);
  const baseSummary = mediaContext?.summary ?? "Assessing how much story structure the uploaded media already provides.";

  return {
    summary: requiresBrief
      ? `${baseSummary} The uploads hint at a story, but they do not yet clearly explain what this is, how it works, or what the audience should take away.`
      : brief
        ? `${baseSummary} The uploaded media plus the written brief provide enough context to generate a focused explainer.`
        : `${baseSummary} The uploaded media already provides enough context to shape an explainer angle.`,
    confidence: normalizedConfidence,
    requiresBrief,
    missingContextPrompts: requiresBrief ? [...MEDIA_LED_MISSING_PROMPTS] : [],
  };
}

function fallbackIdeas(trend: Trend, niche?: string | null, tone?: string | null, mediaContext?: IdeaMediaContext | null): Idea[] {
  const nicheLabel = niche?.trim() || "your niche";
  const toneLabel = tone?.trim() || "clear and practical";
  const isBridgeTopic = trend.fitLabel === "Adjacent angle" || trend.fitLabel === "Broad news";
  const leadAssetLabel = mediaContext?.assetNotes[0]?.label ?? "your strongest uploaded asset";
  const mediaHookSuffix = mediaContext ? " Use the uploaded media as on-screen proof instead of relying on generic stock visuals." : "";
  const mediaBullet = mediaContext
    ? `Open with ${leadAssetLabel} so the audience sees proof for the angle immediately.`
    : "Open with the clearest visual proof you have.";

  return [
    {
      videoTitle: isBridgeTopic ? `${nicheLabel}: The Real Angle Behind ${trend.trendTitle}` : `${trend.trendTitle}: What It Means For ${nicheLabel}`,
      hook: isBridgeTopic
        ? `The headline is broader than your niche, but the useful angle is not. Here is the ${nicheLabel} takeaway that creators can actually use.${mediaHookSuffix}`
        : `Everyone is talking about ${trend.trendTitle}. Here is what actually matters today.${mediaHookSuffix}`,
      bulletOutline: [
        isBridgeTopic ? "What happened and why it crossed into this niche" : "What happened in plain language",
        mediaContext ? mediaBullet : isBridgeTopic ? `The specific ${nicheLabel} angle most people are missing` : "Why creators should care right now",
        "One tactical move you can make this week",
      ],
      cta: "Comment your take and subscribe for daily creator briefings.",
    },
    {
      videoTitle: isBridgeTopic ? `3 ${nicheLabel} Takeaways From ${trend.trendTitle}` : `3 Fast Takes On ${trend.trendTitle}`,
      hook: isBridgeTopic
        ? `You do not need a generic explainer. You need the three implications this story has for ${nicheLabel}.${mediaHookSuffix}`
        : `If you only have one minute, these are the three key updates you need.${mediaHookSuffix}`,
      bulletOutline: [
        isBridgeTopic ? `The clearest link between the story and ${nicheLabel}` : "Top signal from current headlines",
        "Most likely impact in the next 30 days",
        mediaContext
          ? `Tie the final takeaway back to ${leadAssetLabel} so the video can be cut from media you already have.`
          : isBridgeTopic
            ? "How to adapt your content angle without becoming a news channel"
            : "How to adapt your content angle",
      ],
      cta: "Follow for short-form strategy driven by real news.",
    },
    {
      videoTitle: `Hot Take: ${trend.trendTitle} Is Bigger Than It Looks`,
      hook: isBridgeTopic
        ? `Quick ${toneLabel} breakdown of why this story matters for ${nicheLabel}, not just the headline cycle.${mediaHookSuffix}`
        : `Quick ${toneLabel} breakdown of where this story is headed next.${mediaHookSuffix}`,
      bulletOutline: [
        isBridgeTopic ? `The overlooked ${nicheLabel} angle` : "The overlooked angle",
        mediaContext ? `Use ${leadAssetLabel} or a related uploaded asset to make the claim feel concrete.` : "Opportunity for small creators",
        isBridgeTopic ? "Risk to avoid if you cover this story without a clear niche lens" : "Risk to avoid when covering this trend",
      ],
      cta: "Save this and use it as your next video prompt.",
    },
  ];
}

function fallbackMediaLedIdeas(params: {
  trend: Trend;
  brief?: string | null;
  mediaContext?: IdeaMediaContext | null;
  tone?: string | null;
  singlePlan: boolean;
}): Idea[] {
  const brief = cleanBrief(params.brief);
  const leadAsset = params.mediaContext?.assetNotes[0]?.label ?? "your strongest uploaded clip";
  const secondSignal = params.mediaContext?.topSignals[1] ?? params.mediaContext?.topSignals[0] ?? "the key workflow";
  const toneLabel = params.tone?.trim() || "clear";

  if (params.singlePlan) {
    return [
      {
        videoTitle: `${params.trend.trendTitle}: what it is, how it works, and what comes next`,
        hook: brief
          ? `${brief} Use the uploaded media to show the product or story clearly from first frame to future direction.`
          : `Use the uploaded media to explain what this is, how it works, and why ${secondSignal} matters next.`,
        bulletOutline: [
          `Open with ${leadAsset} so the audience immediately sees the core subject.`,
          "Explain the current workflow, sequence, or proof shown in the uploads.",
          "Close with what changes next, what to watch for, or the future direction.",
        ],
        cta: "Comment with the part you want broken down next.",
      },
    ];
  }

  return [
    {
      videoTitle: `${params.trend.trendTitle}: the fast explainer`,
      hook: `Use the uploaded media to explain what the audience is looking at and why it matters in a ${toneLabel} way.`,
      bulletOutline: [
        `Start with ${leadAsset} as the immediate hook.`,
        "Explain the clearest workflow or story thread shown in the uploads.",
        "End with the main takeaway or next step.",
      ],
      cta: "Follow for more breakdowns built from real product and creator workflows.",
    },
    {
      videoTitle: `${params.trend.trendTitle}: how it works in practice`,
      hook: `Turn the uploads into a walkthrough that shows how ${secondSignal} actually works instead of describing it abstractly.`,
      bulletOutline: [
        "Show the setup or before state.",
        "Walk through the most important moments in the uploaded media.",
        "End with the practical result or lesson.",
      ],
      cta: "Save this if you want a deeper walkthrough next.",
    },
    {
      videoTitle: `${params.trend.trendTitle}: what this points to next`,
      hook: brief
        ? `Use the brief plus uploaded media to connect the current state to what comes next.`
        : "Use the uploads to explain the current state first, then pivot into the likely next step or future direction.",
      bulletOutline: [
        "Show the clearest proof from the uploaded media.",
        "Explain the current behavior, feature, or story arc.",
        "Project the future direction, implication, or opportunity.",
      ],
      cta: "Comment with your take on where this goes next.",
    },
  ];
}

function normalizeIdeas(ideas?: Idea[], limit = 3) {
  return (ideas ?? [])
    .filter((idea) => idea?.videoTitle && idea?.hook && idea?.cta)
    .slice(0, limit)
    .map((idea) => ({
      videoTitle: compactText(idea.videoTitle, 120),
      hook: compactText(idea.hook, 240),
      bulletOutline: (idea.bulletOutline ?? []).map((bullet) => compactText(bullet, 180)).filter(Boolean).slice(0, 5),
      cta: compactText(idea.cta, 160),
    }));
}

function normalizeConfidence(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  if (value > 0 && value <= 1) {
    return Math.round(value * 100);
  }

  return Math.round(clamp(value, 0, 100));
}

function normalizeAssessment(value: Partial<IdeaContextAssessment> | undefined, fallback: IdeaContextAssessment) {
  return {
    summary: compactText(value?.summary ?? fallback.summary, 320),
    confidence: normalizeConfidence(value?.confidence) || fallback.confidence,
    requiresBrief: value?.requiresBrief ?? fallback.requiresBrief,
    missingContextPrompts: normalizePromptList(value?.missingContextPrompts ?? fallback.missingContextPrompts),
  };
}

function normalizeDerivedTrend(value: PartialTrendLike, fallback: Trend): Trend {
  return {
    trendTitle: compactText(value?.trendTitle ?? fallback.trendTitle, 90) || fallback.trendTitle,
    summary: compactText(value?.summary ?? fallback.summary, 240) || fallback.summary,
    links: Array.isArray(value?.links) ? value.links.filter((entry): entry is string => typeof entry === "string").slice(0, 5) : fallback.links,
    fitLabel: value?.fitLabel ?? fallback.fitLabel,
    fitReason: value?.fitReason ?? fallback.fitReason,
  };
}

async function generateIdeasFromTrend(params: TrendIdeaParams): Promise<IdeaGenerationResult> {
  const nicheLabel = params.niche?.trim() || "the creator's niche";
  const isBridgeTopic = params.trend.fitLabel === "Adjacent angle" || params.trend.fitLabel === "Broad news";
  const mediaContext = await buildIdeaMediaContext({
    trend: params.trend,
    assets: params.mediaAssets ?? [],
  });

  const llmIdeas = await llmChatJSON<{ ideas: Idea[] }>({
    system:
      "You are a YouTube strategist. Generate exactly 3 creator-ready video ideas with a sharp hook, bullet outline, and CTA. Keep ideas tightly aligned to the creator's niche. If the selected trend is only adjacent or broad, explicitly bridge it back to the niche and avoid generic current-affairs explainers. When uploaded media context is provided, prefer ideas that can be credibly illustrated with those assets and avoid concepts that depend on missing visuals.",
    user: JSON.stringify({
      niche: params.niche,
      tone: params.tone,
      trend: params.trend,
      guidance: isBridgeTopic
        ? `This trend is not a direct ${nicheLabel} match. Every idea must clearly explain the ${nicheLabel} angle in the title or hook.`
        : `This trend is already a direct ${nicheLabel} match. Keep the ideas tightly focused on that niche.`,
      creatorMemorySummary: compactText(params.creatorMemorySummary ?? "", 320) || null,
      mediaGuidance: mediaContext
        ? "Use the uploaded media as proof, demo material, or a hook wherever possible. The ideas should feel executable with the current asset library."
        : "No uploaded media context was linked for this idea generation run.",
      mediaContext,
      outputSchema: {
        ideas: [
          {
            videoTitle: "string",
            hook: "string",
            bulletOutline: ["string", "string", "string"],
            cta: "string",
          },
        ],
      },
    }),
    temperature: 0.65,
  });

  const ideas = normalizeIdeas(llmIdeas?.ideas, 3);

  return {
    ideas: ideas.length >= 3 ? ideas : fallbackIdeas(params.trend, params.niche, params.tone, mediaContext),
    generationMode: "multi-idea",
    contextAssessment: buildTrendAssessment(mediaContext),
    derivedContextTrend: params.trend,
  };
}

async function generateIdeasFromMediaLedInputs(params: MediaLedIdeaParams): Promise<IdeaGenerationResult> {
  const brief = cleanBrief(params.brief);
  const mediaContext = await buildMediaLedContext({
    assets: params.mediaAssets,
    brief,
  });
  const fallbackDerivedTrend = buildFallbackDerivedTrend({
    brief,
    mediaContext,
  });
  const fallbackAssessment = buildMediaLedAssessment({
    mediaContext,
    brief,
  });

  const llmResult = await llmChatJSON<MediaLedLlmResult>({
    system:
      "You are a creator strategist for media-led explainers. Review uploaded media context and an optional freeform brief. First assess how much narrative structure the uploads already provide. Choose exactly one generationMode: 'needs-brief' when the uploads are too ambiguous without more written context, 'single-plan' when the uploads already imply one strong explainer path, or 'multi-idea' when the media supports the topic but still needs a choice of framing. Keep ideas grounded in the uploaded visuals. Return only valid JSON.",
    user: JSON.stringify({
      niche: params.niche,
      tone: params.tone,
      brief: brief || null,
      creatorMemorySummary: compactText(params.creatorMemorySummary ?? "", 320) || null,
      mediaContext,
      decisionRules: {
        needsBriefWhen: "The uploads do not clearly communicate what this is, how it works, or what the audience should take away without more written context.",
        singlePlanWhen: "The uploads already support one obvious explainer or walkthrough structure.",
        multiIdeaWhen: "The uploads are promising but could credibly support multiple angles or framings.",
      },
      outputSchema: {
        generationMode: "single-plan | multi-idea | needs-brief",
        contextAssessment: {
          summary: "string",
          confidence: "number from 0 to 100",
          requiresBrief: "boolean",
          missingContextPrompts: ["string"],
        },
        derivedContextTrend: {
          trendTitle: "string",
          summary: "string",
          links: [],
          fitLabel: "Open feed",
          fitReason: "string",
        },
        ideas: [
          {
            videoTitle: "string",
            hook: "string",
            bulletOutline: ["string", "string", "string"],
            cta: "string",
          },
        ],
      },
    }),
    temperature: 0.45,
  });

  const normalizedAssessment = normalizeAssessment(llmResult?.contextAssessment, fallbackAssessment);
  const derivedContextTrend = normalizeDerivedTrend(llmResult?.derivedContextTrend, fallbackDerivedTrend);
  const llmMode = llmResult?.generationMode;
  const requestedMode: IdeaGenerationMode =
    llmMode === "single-plan" || llmMode === "multi-idea" || llmMode === "needs-brief"
      ? llmMode
      : fallbackAssessment.requiresBrief
        ? "needs-brief"
        : brief.length > 0 || fallbackAssessment.confidence >= 78
          ? "single-plan"
          : "multi-idea";

  if (requestedMode === "needs-brief" || normalizedAssessment.requiresBrief) {
    return {
      ideas: [],
      generationMode: "needs-brief",
      contextAssessment: {
        ...normalizedAssessment,
        requiresBrief: true,
        missingContextPrompts: normalizePromptList(normalizedAssessment.missingContextPrompts),
      },
      derivedContextTrend,
    };
  }

  const normalizedIdeas = normalizeIdeas(llmResult?.ideas, requestedMode === "single-plan" ? 1 : 3);

  if (requestedMode === "single-plan") {
    return {
      ideas: normalizedIdeas.length > 0
        ? normalizedIdeas.slice(0, 1)
        : fallbackMediaLedIdeas({
            trend: derivedContextTrend,
            brief,
            mediaContext,
            tone: params.tone,
            singlePlan: true,
          }),
      generationMode: "single-plan",
      contextAssessment: {
        ...normalizedAssessment,
        requiresBrief: false,
        missingContextPrompts: [],
      },
      derivedContextTrend,
    };
  }

  return {
    ideas:
      normalizedIdeas.length >= 2
        ? normalizedIdeas.slice(0, 3)
        : fallbackMediaLedIdeas({
            trend: derivedContextTrend,
            brief,
            mediaContext,
            tone: params.tone,
            singlePlan: false,
          }),
    generationMode: "multi-idea",
    contextAssessment: {
      ...normalizedAssessment,
      requiresBrief: false,
      missingContextPrompts: [],
    },
    derivedContextTrend,
  };
}

export async function generateIdeas(params: IdeaGenerationParams): Promise<IdeaGenerationResult> {
  if (params.workflow === "media-led") {
    return generateIdeasFromMediaLedInputs(params);
  }

  return generateIdeasFromTrend(params);
}
