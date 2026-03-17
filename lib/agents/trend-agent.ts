import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";
import { formatAgentLog } from "@/lib/agents/logs";

export class TrendDiscoveryAgent implements BaseAgent {
  readonly id = "trend-discovery-agent";
  readonly name = "Trend Discovery Agent";
  readonly responsibility = "Synchronizes active sources, fetches RSS entries, and clusters them into creator-fit trends.";
  readonly tools = ["prisma", "rss", "gemini-veo"] as const;

  async run(state: AgentWorkflowState, context: Parameters<BaseAgent["run"]>[1]) {
    const sourceState = await context.tools.ensureEnabledSources({ user: context.user });
    const sourceUrls = sourceState.sources.map((source) => source.url);

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Loaded ${sourceUrls.length} enabled source(s) for discovery.`,
        tool: "prisma",
      }),
    );

    const entries = await context.tools.fetchTrendEntries(sourceUrls);

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: entries.length === 0 ? "No RSS entries were available for clustering." : `Fetched ${entries.length} RSS entries.`,
        tool: "rss",
      }),
    );

    const trends = entries.length > 0 ? await context.tools.clusterTrendEntries(entries, state.maxTrends ?? 5, context.user.niche) : [];

    await context.log(
      formatAgentLog({
        agent: this.name,
        message: `Ranked ${trends.length} trend candidate(s) for the current creator profile.`,
        tool: "gemini-veo",
      }),
    );

    return {
      trends,
      trendDiscovery: {
        sourceCount: sourceUrls.length,
        entryCount: entries.length,
        sourceSyncNote: sourceState.sourceSyncNote,
      },
    };
  }
}
