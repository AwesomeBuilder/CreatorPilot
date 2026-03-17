import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class ProfileMemoryAgent implements BaseAgent {
  readonly id = "profile-memory-agent";
  readonly name = "Profile / Memory Agent";
  readonly responsibility = "Loads creator profile, saved preferences, and recent outputs from Prisma-backed local state.";
  readonly tools = ["prisma"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    if (state.memory) {
      await context.log(
        formatAgentLog({
          agent: this.name,
          message: "Using memory snapshot already attached to the workflow state.",
          tool: "prisma",
        }),
      );
      return;
    }

    const memory = await context.tools.loadCreatorMemorySnapshot(context.user);

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Loaded ${memory.preferences.enabledSources.length} enabled source(s) and ${memory.pastOutputs.length} recent output(s).`,
        tool: "prisma",
      }),
    );

    return { memory };
  }
}
