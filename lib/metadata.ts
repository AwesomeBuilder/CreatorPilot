import { llmChatJSON } from "@/lib/llm";
import type { Idea, MetadataResult, Trend } from "@/lib/types";

function compactHashtag(word: string) {
  return `#${word
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .slice(0, 30)}`;
}

function fallbackMetadata(trend: Trend, idea: Idea): MetadataResult {
  const tags = trend.trendTitle
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 3)
    .slice(0, 8);

  const hashtags = [compactHashtag(trend.trendTitle), compactHashtag("CreatorNews"), compactHashtag("YouTubeStrategy")].filter(
    (tag, index, all) => tag !== "#" && all.indexOf(tag) === index,
  );

  return {
    youtubeTitle: idea.videoTitle.slice(0, 95),
    description: `${idea.hook}\n\nOutline:\n- ${idea.bulletOutline.join("\n- ")}\n\n${idea.cta}`.slice(0, 4000),
    hashtags,
    captionVariants: [
      `${idea.videoTitle} ${hashtags.join(" ")}`,
      `${idea.hook} ${hashtags.join(" ")}`,
      `${idea.cta} ${hashtags.join(" ")}`,
    ],
    tags,
  };
}

export async function generateMetadata(params: {
  trend: Trend;
  idea: Idea;
  tone?: string | null;
}): Promise<MetadataResult> {
  const llmResult = await llmChatJSON<MetadataResult>({
    system: "You generate YouTube metadata that is clear, non-spammy, and creator-friendly.",
    user: JSON.stringify({
      trend: params.trend,
      idea: params.idea,
      tone: params.tone,
      outputSchema: {
        youtubeTitle: "string <= 100 chars",
        description: "string",
        hashtags: ["#tag"],
        captionVariants: ["string", "string", "string"],
        tags: ["string"],
      },
    }),
    temperature: 0.6,
  });

  if (!llmResult?.youtubeTitle || !llmResult?.description) {
    return fallbackMetadata(params.trend, params.idea);
  }

  return {
    youtubeTitle: llmResult.youtubeTitle.slice(0, 100),
    description: llmResult.description.slice(0, 4900),
    hashtags: (llmResult.hashtags ?? []).slice(0, 8),
    captionVariants: (llmResult.captionVariants ?? []).slice(0, 3),
    tags: (llmResult.tags ?? []).slice(0, 15),
  };
}
