import { IdeationAgent } from "@/lib/agents/ideation-agent";
import { mergeAgentState, type AgentUserContext, type AgentWorkflowState, type BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";
import { MediaSelectionAgent } from "@/lib/agents/media-selection-agent";
import { ProfileMemoryAgent } from "@/lib/agents/memory-agent";
import { MetadataAgent } from "@/lib/agents/metadata-agent";
import { PublishingAgent } from "@/lib/agents/publishing-agent";
import { RenderAgent } from "@/lib/agents/render-agent";
import { StoryboardAgent } from "@/lib/agents/storyboard-agent";
import { createAgentTools, type AgentTools } from "@/lib/agents/tools";
import { TrendDiscoveryAgent } from "@/lib/agents/trend-agent";
import type { Idea, RenderPreference, StoryboardPlan, Trend, WorkflowMode } from "@/lib/types";

type OrchestratorOptions = {
  tools?: AgentTools;
  agents?: BaseAgent[];
};

type WorkflowContext = {
  user: AgentUserContext;
  jobId?: string;
  log?: (message: string) => Promise<void>;
};

type IdeaWorkflowInput = {
  workflow?: WorkflowMode;
  trend?: Trend;
  mediaAssetIds?: string[];
  brief?: string | null;
};

type StoryboardWorkflowInput = {
  trend: Trend;
  idea: Idea;
  mediaAssetIds: string[];
  preference?: RenderPreference;
  storyboard?: StoryboardPlan;
};

type RenderWorkflowInput = StoryboardWorkflowInput;

type MetadataWorkflowInput = {
  trend: Trend;
  idea: Idea;
};

type PublishingWorkflowInput = {
  renderId?: string;
  renderPath?: string;
  title: string;
  description: string;
  tags?: string[];
  publishAt?: string;
};

function noopLog() {
  return Promise.resolve();
}

export class CreatorPilotOrchestrator {
  private readonly tools: AgentTools;
  private readonly agentMap: Record<string, BaseAgent>;

  constructor(options: OrchestratorOptions = {}) {
    const agents =
      options.agents ??
      [
        new ProfileMemoryAgent(),
        new TrendDiscoveryAgent(),
        new MediaSelectionAgent(),
        new IdeationAgent(),
        new StoryboardAgent(),
        new RenderAgent(),
        new MetadataAgent(),
        new PublishingAgent(),
      ];

    this.tools = options.tools ?? createAgentTools();
    this.agentMap = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
  }

  private async runSequence(initialState: AgentWorkflowState, context: WorkflowContext, agentIds: string[]) {
    let state = initialState;
    const log = context.log ?? noopLog;

    for (const agentId of agentIds) {
      const agent = this.agentMap[agentId];
      if (!agent) {
        throw new Error(`Unknown agent ${agentId}.`);
      }

      await log(
        formatAgentLog({
          agent: "Orchestrator Agent",
          message: `Delegating control to ${agent.name}.`,
          tool: "background-jobs",
        }),
      );

      const patch = await agent.run(state, {
        user: context.user,
        tools: this.tools,
        log,
      });

      state = mergeAgentState(state, patch);

      await log(
        formatAgentLog({
          agent: "Orchestrator Agent",
          message: `${agent.name} completed and returned updated workflow state.`,
          tool: "background-jobs",
        }),
      );
    }

    return state;
  }

  async runTrendDiscoveryWorkflow(params: {
    user: AgentUserContext;
    maxTrends?: number;
    jobId?: string;
    log?: (message: string) => Promise<void>;
  }) {
    return this.runSequence(
      {
        workflow: "trend-discovery",
        user: params.user,
        jobId: params.jobId,
        maxTrends: params.maxTrends ?? 5,
      },
      params,
      ["profile-memory-agent", "trend-discovery-agent"],
    );
  }

  async runIdeaWorkflow(params: {
    user: AgentUserContext;
    jobId?: string;
    log?: (message: string) => Promise<void>;
    input: IdeaWorkflowInput;
  }) {
    const sequence = ["profile-memory-agent"] as string[];

    if ((params.input.mediaAssetIds?.length ?? 0) > 0) {
      sequence.push("media-selection-agent");
    }

    sequence.push("ideation-agent");

    return this.runSequence(
      {
        workflow: "idea-generation",
        user: params.user,
        jobId: params.jobId,
        selectedTrend: params.input.trend,
        mediaAssetIds: params.input.mediaAssetIds,
        ideaInput: {
          workflow: params.input.workflow,
          brief: params.input.brief,
          trend: params.input.trend,
        },
      },
      params,
      sequence,
    );
  }

  async runStoryboardWorkflow(params: {
    user: AgentUserContext;
    log?: (message: string) => Promise<void>;
    input: StoryboardWorkflowInput;
  }) {
    return this.runSequence(
      {
        workflow: "storyboard",
        user: params.user,
        selectedTrend: params.input.trend,
        idea: params.input.idea,
        mediaAssetIds: params.input.mediaAssetIds,
        renderPreference: params.input.preference ?? "auto",
        storyboard: params.input.storyboard,
      },
      params,
      ["profile-memory-agent", "media-selection-agent", "storyboard-agent"],
    );
  }

  async runRenderWorkflow(params: {
    user: AgentUserContext;
    jobId: string;
    log?: (message: string) => Promise<void>;
    input: RenderWorkflowInput;
    preparedState?: Partial<AgentWorkflowState>;
  }) {
    return this.runSequence(
      {
        workflow: "render",
        user: params.user,
        jobId: params.jobId,
        selectedTrend: params.input.trend,
        idea: params.input.idea,
        mediaAssetIds: params.input.mediaAssetIds,
        renderPreference: params.input.preference ?? "auto",
        storyboard: params.preparedState?.storyboard ?? params.input.storyboard,
        selectedMediaAssets: params.preparedState?.selectedMediaAssets,
        assessment: params.preparedState?.assessment,
        memory: params.preparedState?.memory,
      },
      params,
      ["profile-memory-agent", "media-selection-agent", "storyboard-agent", "render-agent"],
    );
  }

  async runMetadataWorkflow(params: {
    user: AgentUserContext;
    log?: (message: string) => Promise<void>;
    input: MetadataWorkflowInput;
  }) {
    return this.runSequence(
      {
        workflow: "metadata",
        user: params.user,
        selectedTrend: params.input.trend,
        idea: params.input.idea,
      },
      params,
      ["profile-memory-agent", "metadata-agent"],
    );
  }

  async runPublishingWorkflow(params: {
    user: AgentUserContext;
    jobId?: string;
    log?: (message: string) => Promise<void>;
    input: PublishingWorkflowInput;
  }) {
    return this.runSequence(
      {
        workflow: "publishing",
        user: params.user,
        jobId: params.jobId,
        publishInput: params.input,
      },
      params,
      ["profile-memory-agent", "publishing-agent"],
    );
  }
}

export function createCreatorPilotOrchestrator(options?: OrchestratorOptions) {
  return new CreatorPilotOrchestrator(options);
}
