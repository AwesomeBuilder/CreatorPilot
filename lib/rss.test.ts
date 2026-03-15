import { beforeEach, describe, expect, it, vi } from "vitest";

const rssMock = vi.hoisted(() => {
  const parseUrlMock = vi.fn();

  class Parser {
    parseURL = parseUrlMock;
  }

  return {
    parseURL: parseUrlMock,
    Parser,
  };
});

vi.mock("rss-parser", () => ({
  default: rssMock.Parser,
}));

import { fetchRssEntries } from "@/lib/rss";

describe("fetchRssEntries", () => {
  beforeEach(() => {
    rssMock.parseURL.mockReset();
  });

  it("filters invalid and duplicate URLs, ignores failed feeds, strips HTML, and caps items at 20", async () => {
    const validItems = Array.from({ length: 22 }, (_, index) => ({
      title: `Item ${index + 1}`,
      link: `https://example.com/item-${index + 1}`,
      contentSnippet: `<p>${"Headline ".repeat(60)}</p>`,
      pubDate: "2026-03-15T10:00:00.000Z",
    }));

    rssMock.parseURL.mockImplementation(async (url: string) => {
      if (url === "https://feeds.example.com/fail") {
        throw new Error("feed failed");
      }

      return { items: validItems };
    });

    const entries = await fetchRssEntries([
      "not-a-url",
      "https://feeds.example.com/good",
      "https://feeds.example.com/good",
      "https://feeds.example.com/fail",
    ]);

    expect(rssMock.parseURL).toHaveBeenCalledTimes(2);
    expect(entries).toHaveLength(20);
    expect(entries[0]).toMatchObject({
      title: "Item 1",
      link: "https://example.com/item-1",
      sourceUrl: "https://feeds.example.com/good",
      publishedAt: "2026-03-15T10:00:00.000Z",
    });
    expect(entries[0]?.snippet).not.toContain("<p>");
    expect(entries[0]?.snippet.length).toBeLessThanOrEqual(300);
  });

  it("skips feed items without both title and link", async () => {
    rssMock.parseURL.mockResolvedValue({
      items: [
        { title: "Valid item", link: "https://example.com/valid", contentSnippet: "Valid snippet" },
        { title: "", link: "https://example.com/missing-title", contentSnippet: "Missing title" },
        { title: "Missing link", link: "", contentSnippet: "Missing link" },
      ],
    });

    const entries = await fetchRssEntries(["https://feeds.example.com/good"]);

    expect(entries).toEqual([
      {
        title: "Valid item",
        link: "https://example.com/valid",
        snippet: "Valid snippet",
        sourceUrl: "https://feeds.example.com/good",
        publishedAt: undefined,
      },
    ]);
  });
});
