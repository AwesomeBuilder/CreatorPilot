import { llmChatJSON } from "@/lib/llm";
import type { Idea, Trend } from "@/lib/types";

function fallbackIdeas(trend: Trend, niche?: string | null, tone?: string | null): Idea[] {
  const nicheLabel = niche?.trim() || "your niche";
  const toneLabel = tone?.trim() || "clear and practical";
  const isBridgeTopic = trend.fitLabel === "Adjacent angle" || trend.fitLabel === "Broad news";

  return [
    {
      videoTitle: isBridgeTopic ? `${nicheLabel}: The Real Angle Behind ${trend.trendTitle}` : `${trend.trendTitle}: What It Means For ${nicheLabel}`,
      hook: isBridgeTopic
        ? `The headline is broader than your niche, but the useful angle is not. Here is the ${nicheLabel} takeaway that creators can actually use.`
        : `Everyone is talking about ${trend.trendTitle}. Here is what actually matters today.`,
      bulletOutline: [
        isBridgeTopic ? "What happened and why it crossed into this niche" : "What happened in plain language",
        isBridgeTopic ? `The specific ${nicheLabel} angle most people are missing` : "Why creators should care right now",
        isBridgeTopic ? "One tactical move you can make this week" : "One tactical move you can make this week",
      ],
      cta: "Comment your take and subscribe for daily creator briefings.",
    },
    {
      videoTitle: isBridgeTopic ? `3 ${nicheLabel} Takeaways From ${trend.trendTitle}` : `3 Fast Takes On ${trend.trendTitle}`,
      hook: isBridgeTopic
        ? `You do not need a generic explainer. You need the three implications this story has for ${nicheLabel}.`
        : "If you only have one minute, these are the three key updates you need.",
      bulletOutline: [
        isBridgeTopic ? `The clearest link between the story and ${nicheLabel}` : "Top signal from current headlines",
        isBridgeTopic ? "Most likely impact in the next 30 days" : "Most likely impact in the next 30 days",
        isBridgeTopic ? "How to adapt your content angle without becoming a news channel" : "How to adapt your content angle",
      ],
      cta: "Follow for short-form strategy driven by real news.",
    },
    {
      videoTitle: `Hot Take: ${trend.trendTitle} Is Bigger Than It Looks`,
      hook: isBridgeTopic
        ? `Quick ${toneLabel} breakdown of why this story matters for ${nicheLabel}, not just the headline cycle.`
        : `Quick ${toneLabel} breakdown of where this story is headed next.`,
      bulletOutline: [
        isBridgeTopic ? `The overlooked ${nicheLabel} angle` : "The overlooked angle",
        "Opportunity for small creators",
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
}): Promise<Idea[]> {
  const nicheLabel = params.niche?.trim() || "the creator's niche";
  const isBridgeTopic = params.trend.fitLabel === "Adjacent angle" || params.trend.fitLabel === "Broad news";
  const llmIdeas = await llmChatJSON<{ ideas: Idea[] }>({
    system:
      "You are a YouTube strategist. Generate exactly 3 creator-ready video ideas with a sharp hook, bullet outline, and CTA. Keep ideas tightly aligned to the creator's niche. If the selected trend is only adjacent or broad, explicitly bridge it back to the niche and avoid generic current-affairs explainers.",
    user: JSON.stringify({
      niche: params.niche,
      tone: params.tone,
      trend: params.trend,
      guidance: isBridgeTopic
        ? `This trend is not a direct ${nicheLabel} match. Every idea must clearly explain the ${nicheLabel} angle in the title or hook.`
        : `This trend is already a direct ${nicheLabel} match. Keep the ideas tightly focused on that niche.`,
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
    return fallbackIdeas(params.trend, params.niche, params.tone);
  }

  return llmIdeas.ideas.slice(0, 3).map((idea) => ({
    videoTitle: idea.videoTitle,
    hook: idea.hook,
    bulletOutline: idea.bulletOutline?.slice(0, 5) ?? [],
    cta: idea.cta,
  }));
}
