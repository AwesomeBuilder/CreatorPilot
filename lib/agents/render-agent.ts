import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class RenderAgent implements BaseAgent {
  readonly id = "render-agent";
  readonly name = "Render Agent";
  readonly responsibility = "Runs narration, FFmpeg composition, generated support media, and persisted render storage for final variants.";
  readonly tools = ["ffmpeg", "filesystem", "gemini-veo"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    if (!state.storyboard || !state.idea || !state.jobId) {
      throw new Error("Render workflow requires a jobId, storyboard, and selected idea.");
    }

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Starting render execution for ${state.storyboard.beats.length} storyboard beat(s).`,
        tool: "ffmpeg",
      }),
    );

    const renderOutput = await context.tools.renderVideoVariants({
      userId: context.user.id,
      jobId: state.jobId,
      title: state.idea.videoTitle,
      storyboard: state.storyboard,
      onProgress: async (message) => {
        await context.log(
          formatAgentLog({
            agent: this.name,
            message,
            tool: "ffmpeg",
          }),
        );
      },
    });

    const variants = await context.tools.saveRenderVariants({
      userId: context.user.id,
      jobId: state.jobId,
      variants: renderOutput.variants,
    });

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Persisted ${variants.length} render variant(s) and registered them in Prisma.`,
        tool: "filesystem",
      }),
    );

    return {
      renderOutput: {
        ...renderOutput,
        variants,
      },
      storyboard: renderOutput.storyboard ?? state.storyboard,
    };
  }
}
