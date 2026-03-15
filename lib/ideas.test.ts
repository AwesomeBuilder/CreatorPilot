import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Idea, Trend } from "@/lib/types";

const llmMock = vi.hoisted(() => ({
  llmChatJSON: vi.fn(),
}));

vi.mock("@/lib/llm", () => llmMock);

import { generateIdeas } from "@/lib/ideas";

const baseTrend: Trend = {
  trendTitle: "OpenAI agent platform update",
  summary: "Major AI tooling release for developers.",
  links: ["https://example.com/trend"],
};

function buildIdea(index: number, bulletCount = 3): Idea {
  return {
    videoTitle: `Idea ${index}`,
    hook: `Hook ${index}`,
    bulletOutline: Array.from({ length: bulletCount }, (_, bulletIndex) => `Bullet ${index}-${bulletIndex + 1}`),
    cta: `CTA ${index}`,
  };
}

describe("generateIdeas", () => {
  beforeEach(() => {
    llmMock.llmChatJSON.mockReset();
  });

  it("falls back to bridge-style ideas when the LLM is unavailable", async () => {
    llmMock.llmChatJSON.mockResolvedValue(null);

    const ideas = await generateIdeas({
      trend: {
        ...baseTrend,
        fitLabel: "Adjacent angle",
      },
      niche: "AI & Tech",
      tone: "analytical",
    });

    expect(ideas).toHaveLength(3);
    expect(ideas[0]?.videoTitle).toContain("AI & Tech");
    expect(ideas[0]?.hook).toContain("AI & Tech");
    expect(ideas[2]?.hook).toContain("analytical");
  });

  it("falls back when the LLM returns too few ideas", async () => {
    llmMock.llmChatJSON.mockResolvedValue({
      ideas: [buildIdea(1), buildIdea(2)],
    });

    const ideas = await generateIdeas({
      trend: baseTrend,
      niche: "Creator Economy",
      tone: "direct",
    });

    expect(ideas).toHaveLength(3);
    expect(ideas[0]?.videoTitle).toContain(baseTrend.trendTitle);
  });

  it("keeps only the first three ideas and trims outlines to five bullets", async () => {
    llmMock.llmChatJSON.mockResolvedValue({
      ideas: [buildIdea(1, 6), buildIdea(2), buildIdea(3), buildIdea(4)],
    });

    const ideas = await generateIdeas({
      trend: baseTrend,
      niche: "AI & Tech",
      tone: "clear",
    });

    expect(ideas).toHaveLength(3);
    expect(ideas[0]?.bulletOutline).toHaveLength(5);
    expect(ideas[2]?.videoTitle).toBe("Idea 3");
  });
});
