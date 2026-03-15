import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Idea, Trend } from "@/lib/types";

const llmMock = vi.hoisted(() => ({
  llmChatJSON: vi.fn(),
}));

vi.mock("@/lib/llm", () => llmMock);

import { generateMetadata } from "@/lib/metadata";

const trend: Trend = {
  trendTitle: "Creator News",
  summary: "Platform updates are changing creator workflows.",
  links: ["https://example.com/trend"],
};

const idea: Idea = {
  videoTitle: "A".repeat(120),
  hook: "Hook line for creators.",
  bulletOutline: ["First point", "Second point", "Third point"],
  cta: "Subscribe for the next update.",
};

describe("generateMetadata", () => {
  beforeEach(() => {
    llmMock.llmChatJSON.mockReset();
  });

  it("falls back to deterministic metadata when the LLM fails", async () => {
    llmMock.llmChatJSON.mockResolvedValue(null);

    const result = await generateMetadata({
      trend,
      idea,
      tone: "clear",
    });

    expect(result.youtubeTitle).toHaveLength(95);
    expect(result.description).toContain("Outline:");
    expect(result.hashtags).toEqual(["#CreatorNews", "#YouTubeStrategy"]);
    expect(result.captionVariants).toHaveLength(3);
  });

  it("falls back when the LLM omits required fields", async () => {
    llmMock.llmChatJSON.mockResolvedValue({
      youtubeTitle: "",
      description: "",
    });

    const result = await generateMetadata({
      trend,
      idea,
    });

    expect(result.description).toContain("Hook line for creators.");
    expect(result.tags).toEqual(["creator", "news"]);
  });

  it("trims oversized LLM metadata fields", async () => {
    llmMock.llmChatJSON.mockResolvedValue({
      youtubeTitle: "T".repeat(140),
      description: "D".repeat(6_000),
      hashtags: Array.from({ length: 10 }, (_, index) => `#tag${index}`),
      captionVariants: Array.from({ length: 5 }, (_, index) => `Caption ${index}`),
      tags: Array.from({ length: 20 }, (_, index) => `tag-${index}`),
    });

    const result = await generateMetadata({
      trend,
      idea,
    });

    expect(result.youtubeTitle).toHaveLength(100);
    expect(result.description).toHaveLength(4_900);
    expect(result.hashtags).toHaveLength(8);
    expect(result.captionVariants).toHaveLength(3);
    expect(result.tags).toHaveLength(15);
  });
});
