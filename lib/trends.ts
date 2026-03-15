import { llmChatJSON } from "@/lib/llm";
import { evaluateTrendFit } from "@/lib/niche";
import type { RssEntry } from "@/lib/rss";
import type { Trend, TrendSourceLink } from "@/lib/types";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "in",
  "on",
  "for",
  "of",
  "and",
  "with",
  "from",
  "at",
  "as",
  "is",
  "are",
  "be",
  "by",
  "this",
  "that",
  "how",
  "why",
  "what",
  "new",
  "after",
  "into",
  "about",
  "you",
  "your",
]);

type Cluster = {
  entries: RssEntry[];
  keywordUnion: Set<string>;
};

type ScoredTrend = Trend & {
  fitScore: number;
  rankScore: number;
  freshness: number;
};

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function keywordSet(entry: RssEntry) {
  return new Set(tokenize(`${entry.title} ${entry.snippet ?? ""}`));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) {
    return 0;
  }

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function mergeSets(target: Set<string>, source: Set<string>) {
  for (const item of source) {
    target.add(item);
  }
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function summarizeCluster(cluster: Cluster): Trend {
  const frequency = new Map<string, number>();

  for (const entry of cluster.entries) {
    for (const word of tokenize(entry.title)) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }

  const keywordHeadline = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word)
    .join(" ");

  const sourceLinks: TrendSourceLink[] = cluster.entries.slice(0, 5).map((entry) => ({
    url: entry.link,
    sourceUrl: entry.sourceUrl,
    title: entry.title.slice(0, 180),
    publishedAt: entry.publishedAt,
  }));

  const topTitles = cluster.entries.slice(0, 3).map((entry) => entry.title);
  const links = sourceLinks.map((entry) => entry.url);
  const sourceCount = new Set(cluster.entries.map((entry) => sourceLabel(entry.sourceUrl))).size;

  return {
    trendTitle: keywordHeadline ? keywordHeadline.replace(/\b\w/g, (c) => c.toUpperCase()) : topTitles[0],
    summary: topTitles.slice(0, 2).join(" | "),
    links,
    sourceCount,
    itemCount: cluster.entries.length,
    sourceLinks,
  };
}

async function polishTrendWithLlm(trend: Trend) {
  const llmResult = await llmChatJSON<{ trendTitle: string; summary: string }>({
    system:
      "You create concise, coherent trend labels for creators. Never merge unrelated stories and avoid clickbait wording.",
    user: JSON.stringify({
      trendTitle: trend.trendTitle,
      summary: trend.summary,
      topLinks: (trend.sourceLinks ?? []).map((entry) => ({
        source: sourceLabel(entry.sourceUrl),
        title: entry.title,
      })),
      outputSchema: {
        trendTitle: "short, specific phrase under 12 words",
        summary: "single sentence under 220 chars focused on one coherent trend",
      },
    }),
    temperature: 0.3,
  });

  if (!llmResult?.trendTitle || !llmResult?.summary) {
    return trend;
  }

  return {
    ...trend,
    trendTitle: llmResult.trendTitle.slice(0, 100),
    summary: llmResult.summary.slice(0, 220),
  };
}

function latestPublishedAt(cluster: Cluster) {
  const timestamps = cluster.entries
    .map((entry) => Date.parse(entry.publishedAt ?? ""))
    .filter((value) => Number.isFinite(value));

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

export async function clusterEntriesIntoTrends(entries: RssEntry[], maxTrends = 3, niche?: string | null) {
  const deduped = [...new Map(entries.map((entry) => [entry.link, entry])).values()];

  const clusters: Cluster[] = [];

  for (const entry of deduped) {
    const entryKeywords = keywordSet(entry);

    let bestClusterIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < clusters.length; index += 1) {
      const score = jaccard(entryKeywords, clusters[index].keywordUnion);
      if (score > bestScore) {
        bestScore = score;
        bestClusterIndex = index;
      }
    }

    const shouldCreateCluster = clusters.length < maxTrends && bestScore < 0.22;
    const shouldDropAsNoise = clusters.length >= maxTrends && bestScore < 0.08;

    if (bestClusterIndex === -1 || shouldCreateCluster) {
      clusters.push({
        entries: [entry],
        keywordUnion: new Set(entryKeywords),
      });
      continue;
    }

    if (shouldDropAsNoise) {
      continue;
    }

    clusters[bestClusterIndex].entries.push(entry);
    mergeSets(clusters[bestClusterIndex].keywordUnion, entryKeywords);
  }

  const summarized = clusters.map((cluster) => {
    const trend = summarizeCluster(cluster);
    const fit = evaluateTrendFit({
      niche,
      entries: cluster.entries.map((entry) => ({
        title: entry.title,
        snippet: entry.snippet,
        sourceUrl: entry.sourceUrl,
      })),
    });

    return {
      ...trend,
      fitLabel: fit.label,
      fitReason: fit.reason,
      fitScore: fit.score,
      rankScore: 0,
      freshness: latestPublishedAt(cluster),
    } satisfies ScoredTrend;
  });

  const maxItems = Math.max(1, ...summarized.map((trend) => trend.itemCount ?? 1));
  const maxSources = Math.max(1, ...summarized.map((trend) => trend.sourceCount ?? 1));
  const freshest = Math.max(0, ...summarized.map((trend) => trend.freshness));
  const stalest = Math.min(...summarized.filter((trend) => trend.freshness > 0).map((trend) => trend.freshness), freshest || 0);

  const scored = summarized.map((trend) => {
    const volumeScore = (trend.itemCount ?? 1) / maxItems;
    const diversityScore = (trend.sourceCount ?? 1) / maxSources;
    const recencyScore =
      freshest === 0 || freshest === stalest || trend.freshness === 0 ? 0.6 : (trend.freshness - stalest) / (freshest - stalest);
    const rankScore = trend.fitScore * 0.55 + volumeScore * 0.25 + diversityScore * 0.1 + recencyScore * 0.1;

    return {
      ...trend,
      rankScore,
    };
  });

  const maxRank = Math.max(0.0001, ...scored.map((trend) => trend.rankScore));
  const topTrends = scored
    .sort((left, right) => right.rankScore - left.rankScore)
    .slice(0, maxTrends)
    .map((trend) => ({
      ...trend,
      popularityScore: Math.round((trend.rankScore / maxRank) * 100),
    }));

  const polished = await Promise.all(topTrends.map(async (trend) => polishTrendWithLlm(trend)));
  return polished.map((trend) => ({
    trendTitle: trend.trendTitle,
    summary: trend.summary,
    links: trend.links,
    popularityScore: trend.popularityScore,
    sourceCount: trend.sourceCount,
    itemCount: trend.itemCount,
    sourceLinks: trend.sourceLinks,
    fitLabel: trend.fitLabel,
    fitReason: trend.fitReason,
  }));
}
