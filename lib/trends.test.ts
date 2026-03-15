import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RssEntry } from "@/lib/rss";

const llmMock = vi.hoisted(() => ({
  llmChatJSON: vi.fn(),
}));

vi.mock("@/lib/llm", () => llmMock);

import { clusterEntriesIntoTrends } from "@/lib/trends";

const aiEntryA: RssEntry = {
  title: "OpenAI ships new agent platform for developers",
  link: "https://example.com/ai-1",
  snippet: "Software teams are testing automation workflows.",
  sourceUrl: "https://techcrunch.com/feed/",
  publishedAt: "2026-03-15T09:00:00.000Z",
};

const aiEntryB: RssEntry = {
  title: "Anthropic unveils agent platform tools for developers",
  link: "https://example.com/ai-2",
  snippet: "The model release focuses on software automation.",
  sourceUrl: "https://www.theverge.com/rss/index.xml",
  publishedAt: "2026-03-15T10:00:00.000Z",
};

const financeEntry: RssEntry = {
  title: "Markets slide after earnings miss shocks investors",
  link: "https://example.com/finance-1",
  snippet: "Public companies are revising revenue expectations.",
  sourceUrl: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
  publishedAt: "2026-03-14T10:00:00.000Z",
};

const noiseEntry: RssEntry = {
  title: "Wildfire closes scenic mountain highway for the weekend",
  link: "https://example.com/noise-1",
  snippet: "Emergency crews are still assessing the damage.",
  sourceUrl: "https://example.com/feed",
  publishedAt: "2026-03-13T10:00:00.000Z",
};

describe("clusterEntriesIntoTrends", () => {
  beforeEach(() => {
    llmMock.llmChatJSON.mockReset();
  });

  it("deduplicates links, ranks niche-aligned clusters higher, and drops low-similarity noise", async () => {
    llmMock.llmChatJSON.mockResolvedValue(null);

    const trends = await clusterEntriesIntoTrends(
      [aiEntryA, aiEntryB, { ...aiEntryA, sourceUrl: "https://duplicate.example.com/feed" }, financeEntry, noiseEntry],
      2,
      "AI & Tech",
    );

    expect(trends).toHaveLength(2);
    expect(trends[0]?.fitLabel).toBe("Direct fit");
    expect(trends[0]?.popularityScore).toBe(100);
    expect(trends[0]?.links).toEqual([aiEntryA.link, aiEntryB.link]);
    expect(trends[0]?.sourceCount).toBe(2);
    expect(trends[0]?.itemCount).toBe(2);
    expect(trends.some((trend) => trend.links.includes(noiseEntry.link))).toBe(false);
  });

  it("uses polished trend labels from the LLM when available", async () => {
    llmMock.llmChatJSON.mockResolvedValue({
      trendTitle: "Polished Agent Platform Launch",
      summary: "Developers are reacting to a new wave of agent tooling releases.",
    });

    const trends = await clusterEntriesIntoTrends([aiEntryA, aiEntryB], 3, "AI & Tech");

    expect(trends).toHaveLength(1);
    expect(trends[0]?.trendTitle).toBe("Polished Agent Platform Launch");
    expect(trends[0]?.summary).toBe("Developers are reacting to a new wave of agent tooling releases.");
  });
});
