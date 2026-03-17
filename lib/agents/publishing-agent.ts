import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class PublishingAgent implements BaseAgent {
  readonly id = "publishing-agent";
  readonly name = "Publishing Agent";
  readonly responsibility = "Validates the selected render and uploads it through the YouTube Data API or mock publishing mode.";
  readonly tools = ["youtube-data-api", "filesystem", "ffmpeg"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    if (!state.publishInput) {
      throw new Error("Publishing workflow requires upload input.");
    }

    const resolvedPath = await context.tools.resolveRenderPath({
      userId: context.user.id,
      input: state.publishInput,
    });

    if (!resolvedPath) {
      throw new Error("No render file was provided.");
    }

    const renderProbe = await context.tools.probeStoredRender(resolvedPath);
    if (!renderProbe.hasAudio) {
      throw new Error("This render has no audio track. Generate narration/audio before uploading to YouTube.");
    }

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: "Validated render audio and started the publishing handoff.",
        tool: "youtube-data-api",
      }),
    );

    const publishResult = await context.tools.uploadStoredRender({
      userId: context.user.id,
      filePath: resolvedPath,
      title: state.publishInput.title,
      description: state.publishInput.description,
      tags: state.publishInput.tags,
      publishAt: state.publishInput.publishAt,
    });

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Upload finished in ${publishResult.mode} mode.`,
        tool: "youtube-data-api",
      }),
    );

    return { publishResult };
  }
}
