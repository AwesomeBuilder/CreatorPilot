export type JobStatus = "queued" | "running" | "complete" | "failed";
export type TrendFitLabel = "Direct fit" | "Adjacent angle" | "Broad news" | "Open feed";

export type TrendSourceLink = {
  url: string;
  sourceUrl: string;
  title: string;
  publishedAt?: string;
};

export type Trend = {
  trendTitle: string;
  summary: string;
  links: string[];
  popularityScore?: number;
  sourceCount?: number;
  itemCount?: number;
  sourceLinks?: TrendSourceLink[];
  fitLabel?: TrendFitLabel;
  fitReason?: string;
};

export type Idea = {
  videoTitle: string;
  hook: string;
  bulletOutline: string[];
  cta: string;
};

export type MetadataResult = {
  youtubeTitle: string;
  description: string;
  hashtags: string[];
  captionVariants: string[];
  tags: string[];
};

export type ScheduleRecommendation = {
  publishAt: string;
  reason: string;
  timezone: string;
};

export type RenderFormat = "shorts" | "landscape";
export type RenderPreference = RenderFormat | "auto";

export type MediaRelevanceStatus = "relevant" | "unclear" | "irrelevant";

export type MediaRelevanceAssessment = {
  status: MediaRelevanceStatus;
  confidence: number;
  summary: string;
  matchedSignals: string[];
  shouldBlock: boolean;
};

export type RenderVariant = {
  variantIndex: number;
  path: string;
  duration: number;
};

export type RenderOutput = {
  format: RenderFormat;
  reason: string;
  variants: RenderVariant[];
};
