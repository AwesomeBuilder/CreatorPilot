import { llmChatJSON } from "@/lib/llm";
import type { RssEntry } from "@/lib/rss";
import type { Trend } from "@/lib/types";

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

  const topTitles = cluster.entries.slice(0, 3).map((entry) => entry.title);
  const links = cluster.entries.slice(0, 5).map((entry) => entry.link);

  return {
    trendTitle: keywordHeadline ? keywordHeadline.replace(/\b\w/g, (c) => c.toUpperCase()) : topTitles[0],
    summary: topTitles.join(" | "),
    links,
  };
}

async function polishTrendWithLlm(trend: Trend) {
  const llmResult = await llmChatJSON<{ trendTitle: string; summary: string }>({
    system: "You create concise news trend labels for creators.",
    user: `Rewrite this trend in clean creator-friendly language:\n${JSON.stringify(trend)}`,
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

export async function clusterEntriesIntoTrends(entries: RssEntry[], maxTrends = 3) {
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

    if (bestClusterIndex === -1 || shouldCreateCluster) {
      clusters.push({
        entries: [entry],
        keywordUnion: new Set(entryKeywords),
      });
      continue;
    }

    clusters[bestClusterIndex].entries.push(entry);
    mergeSets(clusters[bestClusterIndex].keywordUnion, entryKeywords);
  }

  const topClusters = clusters.sort((a, b) => b.entries.length - a.entries.length).slice(0, maxTrends);

  const trends = await Promise.all(topClusters.map(async (cluster) => polishTrendWithLlm(summarizeCluster(cluster))));
  return trends;
}
