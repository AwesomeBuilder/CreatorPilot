const TECH = [
  "https://techcrunch.com/feed/",
  "https://www.theverge.com/rss/index.xml",
  "https://feeds.arstechnica.com/arstechnica/index",
  "https://www.wired.com/feed/rss",
];

const BUSINESS = [
  "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
  "https://www.ft.com/rss/home",
  "https://www.cnbc.com/id/100003114/device/rss/rss.html",
  "https://www.forbes.com/business/feed/",
];

const CREATOR = [
  "https://blog.youtube/news-and-events/rss/",
  "https://buffer.com/resources/feed/",
  "https://later.com/blog/feed/",
  "https://www.socialmediaexaminer.com/feed/",
];

export function getCuratedSourcesForNiche(niche?: string | null): string[] {
  const normalized = (niche ?? "").toLowerCase();

  if (normalized.includes("tech") || normalized.includes("ai") || normalized.includes("software")) {
    return TECH;
  }

  if (normalized.includes("business") || normalized.includes("finance") || normalized.includes("startup")) {
    return BUSINESS;
  }

  if (normalized.includes("creator") || normalized.includes("youtube") || normalized.includes("social")) {
    return CREATOR;
  }

  return [...new Set([...TECH.slice(0, 2), ...CREATOR.slice(0, 2), ...BUSINESS.slice(0, 1)])];
}
