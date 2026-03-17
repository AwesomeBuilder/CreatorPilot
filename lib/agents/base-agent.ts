import type {
  Idea,
  IdeaGenerationResult,
  MediaRelevanceAssessment,
  MetadataResult,
  RenderFormat,
  RenderOutput,
  RenderPreference,
  ScheduleRecommendation,
  StoryboardPlan,
  Trend,
  WorkflowMode,
} from "@/lib/types";
import type { AgentTools } from "@/lib/agents/tools";

export type AgentToolName =
  | "background-jobs"
  | "ffmpeg"
  | "filesystem"
  | "gemini-veo"
  | "prisma"
  | "rss"
  | "youtube-data-api";

export type AgentUserContext = {
  id: string;
  niche: string | null;
  tone: string | null;
  timezone: string;
};

export type CreatorMemorySnapshot = {
  profile: AgentUserContext;
  preferences: {
    enabledSources: string[];
    sourceMode: "curated" | "custom" | "mixed" | "none";
    recentRenderFormat: RenderFormat | null;
  };
  pastOutputs: Array<{
    jobId: string;
    type: string;
    createdAt: string;
    format?: RenderFormat | null;
    renderCount?: number;
    publishedUrl?: string | null;
  }>;
  summary: string;
};

export type ResolvedAgentMediaAsset = {
  id: string;
  path: string;
  type: "image" | "video";
};

export type PublishingInput = {
  renderId?: string;
  renderPath?: string;
  title: string;
  description: string;
  tags?: string[];
  publishAt?: string;
};

export type PublishingResult = {
  mode: "mock" | "live";
  videoId?: string | null;
  privacyStatus?: string | null;
  scheduledPublishAt?: string | null;
  url?: string | null;
};

export type AgentWorkflowState = {
  workflow: "trend-discovery" | "idea-generation" | "storyboard" | "render" | "metadata" | "publishing";
  user: AgentUserContext;
  jobId?: string;
  maxTrends?: number;
  selectedTrend?: Trend;
  mediaAssetIds?: string[];
  selectedMediaAssets?: ResolvedAgentMediaAsset[];
  ideaInput?: {
    workflow?: WorkflowMode;
    brief?: string | null;
    trend?: Trend;
  };
  ideasResult?: IdeaGenerationResult;
  idea?: Idea;
  storyboard?: StoryboardPlan;
  assessment?: MediaRelevanceAssessment;
  renderPreference?: RenderPreference;
  renderOutput?: RenderOutput;
  metadata?: MetadataResult;
  schedule?: ScheduleRecommendation;
  trends?: Trend[];
  trendDiscovery?: {
    sourceCount: number;
    entryCount: number;
    sourceSyncNote: string | null;
  };
  memory?: CreatorMemorySnapshot;
  publishInput?: PublishingInput;
  publishResult?: PublishingResult;
};

export type AgentRunContext = {
  user: AgentUserContext;
  tools: AgentTools;
  log: (message: string) => Promise<void>;
};

export interface BaseAgent {
  id: string;
  name: string;
  responsibility: string;
  tools: readonly AgentToolName[];
  run(state: AgentWorkflowState, context: AgentRunContext): Promise<Partial<AgentWorkflowState> | void>;
}

export function mergeAgentState<TState extends AgentWorkflowState>(
  state: TState,
  patch?: Partial<AgentWorkflowState> | void,
) {
  if (!patch) {
    return state;
  }

  return {
    ...state,
    ...patch,
  } satisfies TState;
}
