import { describe, expect, it, vi } from "vitest";

import { CreatorPilotOrchestrator } from "@/lib/agents/orchestrator";
import type { AgentWorkflowState, BaseAgent } from "@/lib/agents/base-agent";

function makeAgent(params: {
  id: string;
  name: string;
  run: (state: AgentWorkflowState) => Partial<AgentWorkflowState> | void | Promise<Partial<AgentWorkflowState> | void>;
}): BaseAgent {
  return {
    id: params.id,
    name: params.name,
    responsibility: `${params.name} responsibility`,
    tools: [],
    run: async (state) => params.run(state),
  };
}

describe("CreatorPilotOrchestrator", () => {
  it("sequences idea workflow state through memory, media selection, and ideation agents", async () => {
    const calls: string[] = [];

    const orchestrator = new CreatorPilotOrchestrator({
      tools: {} as never,
      agents: [
        makeAgent({
          id: "profile-memory-agent",
          name: "Profile / Memory Agent",
          run: () => {
            calls.push("memory");
            return { memory: { summary: "Creator summary." } as AgentWorkflowState["memory"] };
          },
        }),
        makeAgent({
          id: "media-selection-agent",
          name: "Media Selection Agent",
          run: () => {
            calls.push("media");
            return {
              selectedMediaAssets: [{ id: "asset-1", path: "/tmp/a.png", type: "image" }],
            };
          },
        }),
        makeAgent({
          id: "ideation-agent",
          name: "Ideation Agent",
          run: (state) => {
            calls.push("ideation");
            expect(state.memory?.summary).toBe("Creator summary.");
            expect(state.selectedMediaAssets).toEqual([{ id: "asset-1", path: "/tmp/a.png", type: "image" }]);
            return {
              ideasResult: {
                ideas: [{ videoTitle: "Idea", hook: "Hook", bulletOutline: ["A", "B", "C"], cta: "CTA" }],
                generationMode: "multi-idea",
                contextAssessment: {
                  summary: "Enough context.",
                  confidence: 84,
                  requiresBrief: false,
                  missingContextPrompts: [],
                },
                derivedContextTrend: {
                  trendTitle: "Trend",
                  summary: "Summary",
                  links: [],
                },
              },
            };
          },
        }),
      ],
    });

    const log = vi.fn().mockResolvedValue(undefined);

    const state = await orchestrator.runIdeaWorkflow({
      user: {
        id: "user-1",
        niche: "AI & Tech",
        tone: "clear",
        timezone: "America/Los_Angeles",
      },
      input: {
        workflow: "media-led",
        mediaAssetIds: ["asset-1"],
      },
      log,
    });

    expect(calls).toEqual(["memory", "media", "ideation"]);
    expect(state.ideasResult?.ideas).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[Orchestrator Agent]"));
  });

  it("passes prepared render state through to the render workflow", async () => {
    const renderAgent = vi.fn((state: AgentWorkflowState) => ({
      renderOutput: {
        format: "shorts" as const,
        reason: "Prepared state used.",
        variants: [{ variantIndex: 1, path: "/tmp/render.mp4", duration: 42 }],
      },
      storyboard: state.storyboard,
    }));

    const orchestrator = new CreatorPilotOrchestrator({
      tools: {} as never,
      agents: [
        makeAgent({
          id: "profile-memory-agent",
          name: "Profile / Memory Agent",
          run: () => undefined,
        }),
        makeAgent({
          id: "media-selection-agent",
          name: "Media Selection Agent",
          run: (state) => {
            expect(state.selectedMediaAssets).toEqual([{ id: "asset-1", path: "/tmp/a.mp4", type: "video" }]);
            return undefined;
          },
        }),
        makeAgent({
          id: "storyboard-agent",
          name: "Storyboard Agent",
          run: (state) => {
            expect(state.storyboard?.coverageSummary).toBe("Prepared storyboard");
            return undefined;
          },
        }),
        makeAgent({
          id: "render-agent",
          name: "Render Agent",
          run: renderAgent,
        }),
      ],
    });

    const state = await orchestrator.runRenderWorkflow({
      user: {
        id: "user-1",
        niche: "AI & Tech",
        tone: "clear",
        timezone: "America/Los_Angeles",
      },
      jobId: "job-1",
      input: {
        trend: {
          trendTitle: "Trend",
          summary: "Summary",
          links: [],
        },
        idea: {
          videoTitle: "Idea",
          hook: "Hook",
          bulletOutline: ["A", "B", "C"],
          cta: "CTA",
        },
        mediaAssetIds: ["asset-1"],
        preference: "shorts",
      },
      preparedState: {
        selectedMediaAssets: [{ id: "asset-1", path: "/tmp/a.mp4", type: "video" }],
        storyboard: {
          format: "shorts",
          coverageScore: 88,
          coverageSummary: "Prepared storyboard",
          shouldBlock: false,
          requiresMoreRelevantMedia: false,
          generatedSupportEnabled: false,
          generatedSupportUsed: false,
          assetSummaries: [],
          candidates: [],
          beats: [],
        },
      },
    });

    expect(renderAgent).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1" }));
    expect(state.renderOutput?.reason).toBe("Prepared state used.");
  });
});
