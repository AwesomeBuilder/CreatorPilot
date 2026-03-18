export type JobStatus = "queued" | "running" | "complete" | "failed";
export type TrendFitLabel = "Direct fit" | "Adjacent angle" | "Broad news" | "Open feed";
export type WorkflowMode = "trend" | "media-led";

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

export type IdeaGenerationMode = "single-plan" | "multi-idea" | "needs-brief";

export type IdeaContextAssessment = {
  summary: string;
  confidence: number;
  requiresBrief: boolean;
  missingContextPrompts: string[];
};

export type IdeaGenerationResult = {
  ideas: Idea[];
  generationMode: IdeaGenerationMode;
  contextAssessment: IdeaContextAssessment;
  derivedContextTrend: Trend;
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
export type MediaAssetType = "image" | "video";
export type MediaAssetStatus = "pending" | "ready" | "failed";
export type MediaUploadMode = "server" | "direct";
export type MediaAssetRecord = {
  id: string;
  path: string;
  type: MediaAssetType;
  status: MediaAssetStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};
export type MediaSourceKind = "user" | "generated" | "synthetic";
export type CoverageLevel = "strong" | "usable" | "weak" | "missing";
export type BeatPurpose = "hook" | "context" | "proof" | "explanation" | "takeaway" | "cta";
export type GeneratedVisualKind = "still" | "motion";
export type GeneratedVisualProvider = "gemini-image" | "gemini-video" | "stub";
export type NormalizedCropWindow = {
  left: number;
  top: number;
  width: number;
  height: number;
  label?: string;
};

export type MediaRelevanceStatus = "relevant" | "unclear" | "irrelevant";

export type MediaRelevanceAssessment = {
  status: MediaRelevanceStatus;
  confidence: number;
  summary: string;
  matchedSignals: string[];
  shouldBlock: boolean;
  coverageScore?: number;
  requiresGeneratedSupport?: boolean;
};

export type MediaAnalysisCandidate = {
  candidateId: string;
  assetId: string | null;
  assetPath: string;
  assetType: MediaAssetType | "generated";
  source: MediaSourceKind;
  analysisMode?: "multimodal" | "heuristic" | "generated-preview";
  diagnosticMessage?: string;
  label: string;
  width?: number;
  height?: number;
  cropWindow?: NormalizedCropWindow;
  durationSeconds?: number;
  frameTimeSeconds?: number;
  shotStartSeconds?: number;
  shotEndSeconds?: number;
  visualSummary: string;
  compactSummary: string;
  ocrText: string[];
  uiText: string[];
  logos: string[];
  entities: string[];
  topicCues: string[];
  fitScore: number;
  fitReason: string;
  energyScore: number;
  bestUseCases: BeatPurpose[];
};

export type StoryboardSubtitleCue = {
  cueId: string;
  beatId: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
};

export type StoryboardTitleOverlay = {
  beatId: string;
  label: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
};

export type StoryboardGeneratedAssetPlan = {
  requestedKind: GeneratedVisualKind;
  resolvedKind?: GeneratedVisualKind;
  status: "planned" | "generated" | "unavailable" | "not-needed";
  provider: GeneratedVisualProvider;
  prompt: string;
  assetPath?: string | null;
  previewPath?: string | null;
  fallbackAssetPath?: string | null;
  degradedFrom?: GeneratedVisualKind;
  error?: string | null;
};

export type StoryboardBeat = {
  beatId: string;
  order: number;
  purpose: BeatPurpose;
  title: string;
  caption: string;
  narration: string;
  durationSeconds: number;
  visualIntent: string;
  coverageLevel: CoverageLevel;
  matchScore: number;
  selectedCandidateId: string | null;
  selectedAssetId: string | null;
  selectedAssetPath: string | null;
  mediaSource: MediaSourceKind | "none";
  assetType: MediaAssetType | "generated" | "none";
  cropWindow?: NormalizedCropWindow;
  shotStartSeconds?: number;
  shotEndSeconds?: number;
  matchReason: string;
  analysisNote?: string;
  missingCoverageNote?: string;
  missingCoverageGuidance?: string[];
  generatedVisualPrompt?: string;
  generatedVisualStatus?: "planned" | "generated" | "unavailable" | "not-needed";
  generatedPreviewPath?: string | null;
  generatedAssetPlan?: StoryboardGeneratedAssetPlan;
  timelineStartSeconds?: number;
  timelineEndSeconds?: number;
  subtitleCues?: StoryboardSubtitleCue[];
  titleOverlay?: StoryboardTitleOverlay;
  supportingVisuals?: StoryboardSupportingVisual[];
};

export type StoryboardSupportingVisual = {
  visualId: string;
  assetId: string | null;
  assetPath: string | null;
  assetType: MediaAssetType | "generated" | "none";
  mediaSource: MediaSourceKind | "none";
  label: string;
  cropWindow?: NormalizedCropWindow;
  shotStartSeconds?: number;
  shotEndSeconds?: number;
  generatedVisualPrompt?: string;
  generatedVisualStatus?: "planned" | "generated" | "unavailable" | "not-needed";
  generatedPreviewPath?: string | null;
  generatedAssetPlan?: StoryboardGeneratedAssetPlan;
};

export type StoryboardAssetSummary = {
  assetId: string;
  assetPath: string;
  type: MediaAssetType;
  compactSummary: string;
  bestFitScore: number;
  topCues: string[];
  shotCount: number;
  analysisMode?: "multimodal" | "heuristic";
  diagnosticMessage?: string;
};

export type StoryboardDiagnostics = {
  multimodalEnabled: boolean;
  multimodalStatus: "enabled" | "disabled" | "partial" | "failed";
  multimodalFailureReasons: string[];
  fallbackAssetCount: number;
  imageGenerationEnabled: boolean;
  imageGenerationStatus: "enabled" | "disabled" | "partial" | "failed";
  imageGenerationFailureReasons: string[];
  generatedPreviewCount: number;
};

export type StoryboardPlan = {
  format: RenderFormat;
  coverageScore: number;
  coverageSummary: string;
  shouldBlock: boolean;
  requiresMoreRelevantMedia: boolean;
  generatedSupportEnabled: boolean;
  generatedSupportUsed: boolean;
  recommendedUploads?: string[];
  diagnostics?: StoryboardDiagnostics;
  assetSummaries: StoryboardAssetSummary[];
  candidates: MediaAnalysisCandidate[];
  beats: StoryboardBeat[];
  durationSeconds?: number;
  subtitleCues?: StoryboardSubtitleCue[];
};

export type RenderVariant = {
  variantIndex: number;
  path: string;
  duration: number;
  hasAudio?: boolean;
  audioSummary?: string;
};

export type RenderAudioLayerStatus = "generated" | "mixed" | "missing" | "disabled" | "unavailable" | "skipped";

export type RenderAudioComposition = {
  summary: string;
  narration: {
    status: RenderAudioLayerStatus;
    spokenSegmentCount: number;
    beatCount: number;
    cueCount: number;
    modelUsed?: string | null;
    error?: string | null;
  };
  backgroundMusic: {
    status: RenderAudioLayerStatus;
    sourcePath?: string | null;
    gainDb?: number;
    duckingDb?: number;
    error?: string | null;
  };
  transitionSfx: {
    status: RenderAudioLayerStatus;
    sourcePath?: string | null;
    eventCount?: number;
    gainDb?: number;
    error?: string | null;
  };
};

export type RenderOutput = {
  format: RenderFormat;
  reason: string;
  variants: RenderVariant[];
  audioStatus?: "generated" | "missing";
  audioError?: string | null;
  audioComposition?: RenderAudioComposition;
  generatedVideoBeatCount?: number;
  generatedVideoFailureCount?: number;
  storyboard?: StoryboardPlan;
};
