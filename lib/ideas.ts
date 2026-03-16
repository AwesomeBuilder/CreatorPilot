import path from "node:path";

import { llmChatJSON } from "@/lib/llm";
import { buildStoryboardPlan } from "@/lib/storyboard";
import type { Idea, Trend } from "@/lib/types";

type UploadedMediaAsset = {
  id?: string;
  path: string;
  type: "image" | "video";
};

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
};

function fallbackMediaContext(assets: UploadedMediaAsset[]): IdeaMediaContext {
  const imageCount = assets.filter((asset) => asset.type === "image").length;
  const videoCount = assets.length - imageCount;

  return {
    assetCount: assets.length,
    summary: `The creator has ${assets.length} uploaded asset${assets.length === 1 ? "" : "s"} available (${videoCount} video${videoCount === 1 ? "" : "s"}, ${imageCount} image${imageCount === 1 ? "" : "s"}). Prefer ideas that can be illustrated with those existing uploads.`,
    assetNotes: assets.slice(0, 4).map((asset) => ({
      label: path.basename(asset.path),
      type: asset.type,
      summary: `Uploaded ${asset.type}: ${path.basename(asset.path)}`,
      topCues: [],
    })),
    recommendedUploads: [],
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
    };
  } catch {
    return fallbackMediaContext(params.assets);
  }
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
        isBridgeTopic ? "One tactical move you can make this week" : "One tactical move you can make this week",
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
        isBridgeTopic ? "Most likely impact in the next 30 days" : "Most likely impact in the next 30 days",
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

export async function generateIdeas(params: {
  trend: Trend;
  niche?: string | null;
  tone?: string | null;
  mediaAssets?: UploadedMediaAsset[];
}): Promise<Idea[]> {
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

  if (!llmIdeas?.ideas || llmIdeas.ideas.length < 3) {
    return fallbackIdeas(params.trend, params.niche, params.tone, mediaContext);
  }

  return llmIdeas.ideas.slice(0, 3).map((idea) => ({
    videoTitle: idea.videoTitle,
    hook: idea.hook,
    bulletOutline: idea.bulletOutline?.slice(0, 5) ?? [],
    cta: idea.cta,
  }));
}
