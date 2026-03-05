import { llmChatJSON } from "@/lib/llm";
import type { Idea, Trend } from "@/lib/types";

function fallbackIdeas(trend: Trend, niche?: string | null, tone?: string | null): Idea[] {
  const nicheLabel = niche?.trim() || "your niche";
  const toneLabel = tone?.trim() || "clear and practical";

  return [
    {
      videoTitle: `${trend.trendTitle}: What It Means For ${nicheLabel}`,
      hook: `Everyone is talking about ${trend.trendTitle}. Here is what actually matters today.`,
      bulletOutline: [
        "What happened in plain language",
        "Why creators should care right now",
        "One tactical move you can make this week",
      ],
      cta: "Comment your take and subscribe for daily creator briefings.",
    },
    {
      videoTitle: `3 Fast Takes On ${trend.trendTitle}`,
      hook: "If you only have one minute, these are the three key updates you need.",
      bulletOutline: [
        "Top signal from current headlines",
        "Most likely impact in the next 30 days",
        "How to adapt your content angle",
      ],
      cta: "Follow for short-form strategy driven by real news.",
    },
    {
      videoTitle: `Hot Take: ${trend.trendTitle} Is Bigger Than It Looks`,
      hook: `Quick ${toneLabel} breakdown of where this story is headed next.`,
      bulletOutline: [
        "The overlooked angle",
        "Opportunity for small creators",
        "Risk to avoid when covering this trend",
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
  const llmIdeas = await llmChatJSON<{ ideas: Idea[] }>({
    system:
      "You are a YouTube strategist. Generate exactly 3 creator-ready video ideas with a sharp hook, bullet outline, and CTA.",
    user: JSON.stringify({
      niche: params.niche,
      tone: params.tone,
      trend: params.trend,
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
