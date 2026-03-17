import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class MetadataAgent implements BaseAgent {
  readonly id = "metadata-agent";
  readonly name = "Metadata Agent";
  readonly responsibility = "Generates YouTube metadata and recommended publish timing from the selected trend, idea, and creator profile.";
  readonly tools = ["gemini-veo", "prisma"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    const trend = state.selectedTrend;
    const idea = state.idea ?? state.ideasResult?.ideas[0];

    if (!trend || !idea) {
      throw new Error("Metadata workflow requires a selected trend and idea.");
    }

    const metadata = await context.tools.generateMetadata({
      trend,
      idea,
      tone: context.user.tone,
    });
    const schedule = context.tools.recommendPublishTime(context.user.timezone);

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Generated metadata plus a recommended publish time in ${context.user.timezone}.`,
        tool: "gemini-veo",
      }),
    );

    return {
      metadata,
      schedule,
      idea,
    };
  }
}
