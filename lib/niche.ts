import { getCuratedSourcesForNiche } from "@/lib/default-sources";
import type { TrendFitLabel } from "@/lib/types";

const NICHE_KEYWORDS: Record<string, string[]> = {
  "AI & Tech": [
    "ai",
    "artificial intelligence",
    "openai",
    "gpt",
    "claude",
    "anthropic",
    "gemini",
    "llm",
    "agent",
    "agents",
    "chip",
    "chips",
    "gpu",
    "nvidia",
    "semiconductor",
    "software",
    "developer",
    "coding",
    "robot",
    "robotics",
    "startup",
    "model",
    "models",
    "data center",
    "inference",
    "automation",
  ],
  "Business & Finance": [
    "market",
    "markets",
    "stock",
    "stocks",
    "earnings",
    "ipo",
    "valuation",
    "funding",
    "revenue",
    "profit",
    "finance",
    "bank",
    "banking",
    "inflation",
    "economy",
    "investment",
    "investor",
    "venture",
    "business",
    "consumer",
    "trade",
  ],
  "Creator Economy": [
    "youtube",
    "creator",
    "creators",
    "tiktok",
    "instagram",
    "social media",
    "brand deal",
    "brand deals",
    "monetization",
    "audience",
    "subscriber",
    "subscribers",
    "algorithm",
    "shorts",
    "reels",
    "podcast",
    "newsletter",
    "ugc",
    "influencer",
    "engagement",
  ],
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countKeywordMatches(text: string, keywords: string[]) {
  return keywords.filter((keyword) => new RegExp(`\\b${escapeRegExp(keyword).replace(/\\ /g, "\\s+")}\\b`, "i").test(text));
}

function normalizeNiche(niche?: string | null) {
  const normalized = (niche ?? "").trim().toLowerCase();

  if (!normalized || normalized.includes("general")) {
    return "General / Mixed";
  }

  if (normalized.includes("tech") || normalized.includes("ai") || normalized.includes("software")) {
    return "AI & Tech";
  }

  if (normalized.includes("business") || normalized.includes("finance") || normalized.includes("startup")) {
    return "Business & Finance";
  }

  if (normalized.includes("creator") || normalized.includes("youtube") || normalized.includes("social")) {
    return "Creator Economy";
  }

  return "General / Mixed";
}

export function evaluateTrendFit(params: {
  niche?: string | null;
  entries: Array<{
    title: string;
    snippet?: string;
    sourceUrl: string;
  }>;
}): { score: number; label: TrendFitLabel; reason: string } {
  const niche = normalizeNiche(params.niche);

  if (niche === "General / Mixed") {
    return {
      score: 1,
      label: "Open feed",
      reason: "Ranking this topic by coverage and recency across your configured feeds.",
    };
  }

  const keywords = NICHE_KEYWORDS[niche] ?? [];
  const combinedText = params.entries.map((entry) => `${entry.title} ${entry.snippet ?? ""}`).join(" ");
  const matchedKeywords = countKeywordMatches(combinedText, keywords);
  const keywordScore = Math.min(1, matchedKeywords.length / 5);

  const nicheSources = new Set(getCuratedSourcesForNiche(niche));
  const uniqueSources = [...new Set(params.entries.map((entry) => entry.sourceUrl))];
  const matchingSources = uniqueSources.filter((sourceUrl) => nicheSources.has(sourceUrl));
  const sourceScore = uniqueSources.length > 0 ? matchingSources.length / uniqueSources.length : 0;

  const score = Math.min(1, keywordScore * 0.8 + sourceScore * 0.2);
  const keywordPreview = matchedKeywords.slice(0, 3).join(", ");

  if (score >= 0.55) {
    return {
      score,
      label: "Direct fit",
      reason: keywordPreview
        ? `Strong ${niche} overlap from signals like ${keywordPreview}.`
        : `Strong ${niche} overlap from the source mix and repeated story framing.`,
    };
  }

  if (score >= 0.22) {
    return {
      score,
      label: "Adjacent angle",
      reason: keywordPreview
        ? `Some ${niche} overlap from signals like ${keywordPreview}; ideas should make the niche connection explicit.`
        : `This is adjacent to ${niche}; ideas should bridge the story back to the niche instead of treating it as pure news commentary.`,
    };
  }

  return {
    score,
    label: "Broad news",
    reason: `Low ${niche} overlap. This trend is prominent in your feeds, but it is not a strong niche match.`,
  };
}
