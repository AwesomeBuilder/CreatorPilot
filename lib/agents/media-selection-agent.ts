import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class MediaSelectionAgent implements BaseAgent {
  readonly id = "media-selection-agent";
  readonly name = "Media Selection Agent";
  readonly responsibility = "Resolves requested uploads from Prisma and the local filesystem into workflow-ready media assets.";
  readonly tools = ["prisma", "filesystem"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    if (state.selectedMediaAssets) {
      await context.log(
        formatAgentLog({
          agent: this.name,
          message: `Using ${state.selectedMediaAssets.length} media asset(s) already attached to the workflow state.`,
          tool: "prisma",
        }),
      );
      return;
    }

    const mediaReferences = state.mediaAssetIds ?? [];

    if (mediaReferences.length === 0) {
      await context.log(
        formatAgentLog({
          agent: this.name,
          message: "No media references were provided for this workflow.",
          tool: "prisma",
        }),
      );
      return {
        selectedMediaAssets: [],
      };
    }

    const selectedMediaAssets = await context.tools.resolveMediaAssets({
      userId: context.user.id,
      mediaReferences,
    });

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Resolved ${selectedMediaAssets.length}/${mediaReferences.length} requested media asset(s).`,
        tool: "filesystem",
      }),
    );

    return { selectedMediaAssets };
  }
}
