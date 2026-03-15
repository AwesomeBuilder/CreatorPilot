import { describe, expect, it } from "vitest";

import {
  CURATED_SOURCE_PRESETS,
  areSameSourceSets,
  findMatchingCuratedPreset,
  getCuratedSourcesForNiche,
  isCuratedSourceUrl,
} from "@/lib/default-sources";

describe("default sources", () => {
  it("compares source sets independent of order, whitespace, and duplicates", () => {
    expect(
      areSameSourceSets(
        [" https://a.example/feed ", "https://b.example/feed", "https://a.example/feed"],
        ["https://b.example/feed", "https://a.example/feed"],
      ),
    ).toBe(true);
  });

  it("finds matching curated presets after normalization", () => {
    const preset = CURATED_SOURCE_PRESETS["AI & Tech"];

    expect(findMatchingCuratedPreset([preset[1], ` ${preset[0]} `, preset[2], preset[3], preset[0]])).toBe("AI & Tech");
    expect(findMatchingCuratedPreset(["https://example.com/feed"])).toBeNull();
  });

  it("identifies curated URLs", () => {
    expect(isCuratedSourceUrl(CURATED_SOURCE_PRESETS["Creator Economy"][0])).toBe(true);
    expect(isCuratedSourceUrl("https://example.com/feed")).toBe(false);
  });

  it("maps niches to curated source presets and falls back to general mixed", () => {
    expect(getCuratedSourcesForNiche("AI tools and software")).toEqual(CURATED_SOURCE_PRESETS["AI & Tech"]);
    expect(getCuratedSourcesForNiche("startup finance")).toEqual(CURATED_SOURCE_PRESETS["Business & Finance"]);
    expect(getCuratedSourcesForNiche("youtube strategy")).toEqual(CURATED_SOURCE_PRESETS["Creator Economy"]);
    expect(getCuratedSourcesForNiche("something custom")).toEqual(CURATED_SOURCE_PRESETS["General / Mixed"]);
  });
});
