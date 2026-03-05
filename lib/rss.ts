import Parser from "rss-parser";

export type RssEntry = {
  title: string;
  link: string;
  snippet: string;
  sourceUrl: string;
  publishedAt?: string;
};

const parser = new Parser();

function isValidUrl(url: string) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function fetchRssEntries(urls: string[]) {
  const uniqueUrls = [...new Set(urls)].filter(Boolean).filter(isValidUrl);

  const feeds = await Promise.allSettled(
    uniqueUrls.map(async (url) => {
      const feed = await parser.parseURL(url);
      return { url, feed };
    }),
  );

  const entries: RssEntry[] = [];

  for (const result of feeds) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const { url, feed } = result.value;

    for (const item of feed.items.slice(0, 20)) {
      const title = item.title?.trim();
      const link = item.link?.trim();

      if (!title || !link) {
        continue;
      }

      entries.push({
        title,
        link,
        sourceUrl: url,
        snippet: (item.contentSnippet ?? item.content ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
        publishedAt: item.pubDate,
      });
    }
  }

  return entries;
}
