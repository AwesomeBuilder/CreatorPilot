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

const GENERAL_MIXED = [...new Set([...TECH.slice(0, 2), ...CREATOR.slice(0, 2), ...BUSINESS.slice(0, 1)])];

export const CURATED_SOURCE_PRESETS = {
  "AI & Tech": TECH,
  "Business & Finance": BUSINESS,
  "Creator Economy": CREATOR,
  "General / Mixed": GENERAL_MIXED,
} as const;

function normalizeSourceList(urls: string[]) {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))].sort();
}

export function areSameSourceSets(left: string[], right: string[]) {
  const normalizedLeft = normalizeSourceList(left);
  const normalizedRight = normalizeSourceList(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((url, index) => url === normalizedRight[index]);
}

export function findMatchingCuratedPreset(urls: string[]) {
  const normalizedUrls = normalizeSourceList(urls);

  for (const [preset, sourceUrls] of Object.entries(CURATED_SOURCE_PRESETS)) {
    if (areSameSourceSets(normalizedUrls, sourceUrls)) {
      return preset as keyof typeof CURATED_SOURCE_PRESETS;
    }
  }

  return null;
}

export function isCuratedSourceUrl(url: string) {
  return Object.values(CURATED_SOURCE_PRESETS).some((preset) => preset.includes(url));
}

export function getCuratedSourcesForNiche(niche?: string | null): string[] {
  const normalized = (niche ?? "").toLowerCase();

  if (normalized.includes("tech") || normalized.includes("ai") || normalized.includes("software")) {
    return [...TECH];
  }

  if (normalized.includes("business") || normalized.includes("finance") || normalized.includes("startup")) {
    return [...BUSINESS];
  }

  if (normalized.includes("creator") || normalized.includes("youtube") || normalized.includes("social")) {
    return [...CREATOR];
  }

  return [...GENERAL_MIXED];
}
