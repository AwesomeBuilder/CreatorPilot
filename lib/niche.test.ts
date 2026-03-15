import { describe, expect, it } from "vitest";

import { CURATED_SOURCE_PRESETS } from "@/lib/default-sources";
import { evaluateTrendFit } from "@/lib/niche";

describe("evaluateTrendFit", () => {
  it("treats general feeds as open feed ranking", () => {
    expect(
      evaluateTrendFit({
        niche: "General / Mixed",
        entries: [
          {
            title: "A broad news headline",
            sourceUrl: "https://example.com/feed",
          },
        ],
      }),
    ).toEqual({
      score: 1,
      label: "Open feed",
      reason: "Ranking this topic by coverage and recency across your configured feeds.",
    });
  });

  it("marks strongly aligned stories as direct fit", () => {
    const result = evaluateTrendFit({
      niche: "AI & Tech",
      entries: [
        {
          title: "OpenAI agent platform helps developer automation teams",
          snippet: "New model tooling improves software workflows and inference.",
          sourceUrl: CURATED_SOURCE_PRESETS["AI & Tech"][0],
        },
        {
          title: "Nvidia chips push AI model performance higher",
          snippet: "Developers are testing new agent and robotics workloads.",
          sourceUrl: CURATED_SOURCE_PRESETS["AI & Tech"][1],
        },
      ],
    });

    expect(result.label).toBe("Direct fit");
    expect(result.score).toBeGreaterThanOrEqual(0.55);
    expect(result.reason).toContain("AI & Tech");
  });

  it("marks partial overlap as an adjacent angle", () => {
    const result = evaluateTrendFit({
      niche: "AI & Tech",
      entries: [
        {
          title: "City budget debate spills into a broader policy fight",
          snippet: "One AI mention appears, but the story is mostly about local politics.",
          sourceUrl: CURATED_SOURCE_PRESETS["AI & Tech"][0],
        },
      ],
    });

    expect(result.label).toBe("Adjacent angle");
    expect(result.score).toBeGreaterThanOrEqual(0.22);
    expect(result.score).toBeLessThan(0.55);
  });

  it("marks low overlap stories as broad news", () => {
    const result = evaluateTrendFit({
      niche: "AI & Tech",
      entries: [
        {
          title: "Wildfire closes scenic mountain highway for the weekend",
          snippet: "Emergency crews are still assessing the damage.",
          sourceUrl: "https://example.com/feed",
        },
      ],
    });

    expect(result.label).toBe("Broad news");
    expect(result.score).toBeLessThan(0.22);
  });
});
