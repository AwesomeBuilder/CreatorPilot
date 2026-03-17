import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class StoryboardAgent implements BaseAgent {
  readonly id = "storyboard-agent";
  readonly name = "Storyboard Agent";
  readonly responsibility = "Turns a selected idea and media set into a beat-by-beat storyboard with coverage scoring and preview hydration.";
  readonly tools = ["gemini-veo", "filesystem"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    if ((state.selectedMediaAssets?.length ?? 0) === 0) {
      throw new Error("No valid media assets found for storyboarding.");
    }

    const trend = state.selectedTrend;
    const idea = state.idea ?? state.ideasResult?.ideas[0];

    if (!trend || !idea) {
      throw new Error("Storyboard workflow requires a selected trend and idea.");
    }

    let storyboard = state.storyboard;

    if (storyboard) {
      await context.log(
        formatAgentLog({
          agent: this.name,
          message: "Using storyboard payload provided by the client and recomputing its coverage assessment.",
          tool: "filesystem",
        }),
      );
    } else {
      await context.log(
        formatAgentLog({
          agent: this.name,
          message: `Building storyboard coverage for ${state.selectedMediaAssets?.length ?? 0} media asset(s).`,
          tool: "gemini-veo",
        }),
      );

      const baseStoryboard = await context.tools.buildStoryboard({
        trend,
        idea,
        assets: (state.selectedMediaAssets ?? []).map((asset) => ({
          id: asset.id,
          path: asset.path,
          type: asset.type,
        })),
        preference: state.renderPreference ?? "auto",
      });

      storyboard = await context.tools.hydrateStoryboardGeneratedPreviews({
        userId: context.user.id,
        scopeId: `storyboard-${Date.now()}`,
        storyboard: baseStoryboard,
      });
    }

    const assessment = context.tools.storyboardToAssessment(storyboard);

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Coverage scored ${storyboard.coverageScore}/100 and ${storyboard.shouldBlock ? "still blocks render." : "is render-ready."}`,
        tool: "gemini-veo",
      }),
    );

    return {
      storyboard,
      assessment,
      idea,
    };
  }
}
