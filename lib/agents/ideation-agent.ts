import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class IdeationAgent implements BaseAgent {
  readonly id = "ideation-agent";
  readonly name = "Ideation Agent";
  readonly responsibility = "Generates creator-ready video angles using the selected trend or creator-uploaded media plus memory context.";
  readonly tools = ["gemini-veo", "prisma"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    const workflowMode = state.ideaInput?.workflow ?? "trend";

    await context.log(
      formatAgentLog({
        agent: this.name,
        message:
          workflowMode === "media-led"
            ? "Evaluating uploaded media and creator memory to produce media-led angles."
            : "Generating trend-led ideas with creator memory in the prompt context.",
        tool: "gemini-veo",
      }),
    );

    const ideasResult =
      workflowMode === "media-led"
        ? await context.tools.generateIdeas({
            workflow: "media-led",
            brief: state.ideaInput?.brief,
            niche: context.user.niche,
            tone: context.user.tone,
            mediaAssets: state.selectedMediaAssets ?? [],
            creatorMemorySummary: state.memory?.summary,
          })
        : await context.tools.generateIdeas({
            workflow: "trend",
            trend: state.ideaInput?.trend ?? state.selectedTrend!,
            niche: context.user.niche,
            tone: context.user.tone,
            mediaAssets: state.selectedMediaAssets ?? [],
            creatorMemorySummary: state.memory?.summary,
          });

    await context.log(
      formatAgentLog({
        agent: this.name,
        message:
          ideasResult.generationMode === "needs-brief"
            ? "The media context is too ambiguous, so the next decision should request a written brief."
            : `Prepared ${ideasResult.ideas.length} idea candidate(s) in ${ideasResult.generationMode} mode.`,
        tool: "gemini-veo",
      }),
    );

    return {
      ideasResult,
      selectedTrend: workflowMode === "media-led" ? ideasResult.derivedContextTrend : state.selectedTrend,
    };
  }
}
