# Creator Pilot Multi-Agent Architecture

![Creator Pilot multi-agent architecture](./creator-pilot-architecture.svg)

## Component Map

- **Creator Workspace**: `/dashboard`, `/onboarding`, and `/jobs/[id]` remain the operator surface for trend-led and media-led runs.
- **Next.js Control Surface**: `/api/trends`, `/api/ideas`, `/api/storyboard`, `/api/render`, `/api/metadata`, and `/api/youtube` now delegate control to the orchestrator instead of composing the whole workflow inline.
- **Orchestrator Agent**: [`lib/agents/orchestrator.ts`](../../lib/agents/orchestrator.ts) owns workflow state and decides which specialist agent runs next.
- **Profile / Memory Agent**: [`lib/agents/memory-agent.ts`](../../lib/agents/memory-agent.ts) loads creator profile, enabled sources, recent render history, and recent publishing outcomes from Prisma.
- **Trend Discovery Agent**: [`lib/agents/trend-agent.ts`](../../lib/agents/trend-agent.ts) wraps feed synchronization, RSS fetch, clustering, and creator-fit ranking.
- **Ideation Agent**: [`lib/agents/ideation-agent.ts`](../../lib/agents/ideation-agent.ts) wraps `generateIdeas()` and injects memory summary into trend-led and media-led prompting.
- **Media Selection Agent**: [`lib/agents/media-selection-agent.ts`](../../lib/agents/media-selection-agent.ts) resolves uploaded assets from IDs or stored paths.
- **Storyboard Agent**: [`lib/agents/storyboard-agent.ts`](../../lib/agents/storyboard-agent.ts) wraps storyboard coverage analysis, preview hydration, and render gating.
- **Render Agent**: [`lib/agents/render-agent.ts`](../../lib/agents/render-agent.ts) wraps narration, FFmpeg composition, persisted variants, and render registration.
- **Metadata Agent**: [`lib/agents/metadata-agent.ts`](../../lib/agents/metadata-agent.ts) wraps YouTube metadata generation plus publish-time recommendation.
- **Publishing Agent**: [`lib/agents/publishing-agent.ts`](../../lib/agents/publishing-agent.ts) validates stored renders and uploads them in live or mock mode.
- **Memory / Context Store**: the system uses existing Prisma tables as memory. `User` and `Source` hold creator profile and preferences, `Job.outputJson` and `Render` hold recent outputs, and the memory snapshot is assembled in [`lib/agents/tools.ts`](../../lib/agents/tools.ts).
- **Agent Tools Layer**: the agents call current integrations, not new infrastructure. Those tool wrappers point at RSS feeds, Gemini/Veo, FFmpeg/ffprobe, the YouTube Data API, and local asset storage.
- **Runtime Grounding**: the app is still a single Next.js monolith with App Router pages, Route Handlers, Prisma + SQLite, local files under `uploads/` and `renders/`, and in-process background jobs from [`lib/jobs.ts`](../../lib/jobs.ts).

## Control Flow

1. A Route Handler receives the request and resolves the local user.
2. The route creates a job when work is long-running, then hands control to the orchestrator.
3. The orchestrator initializes workflow state and delegates to specialist agents.
4. Each agent uses tool wrappers from [`lib/agents/tools.ts`](../../lib/agents/tools.ts) to call existing services in `lib/`.
5. Agent logs are written into the current job log stream with explicit prefixes such as `[Orchestrator Agent]` and `[Render Agent]`.
6. The UI reads those logs and renders live agent activity through [`components/AgentActivityPanel.tsx`](../../components/AgentActivityPanel.tsx).
7. Publishing results are written back to `Job.outputJson`, and the next ideation run reads them through the Memory Agent.

## Feedback Loop

- Publishing -> Memory: upload results are already persisted in `Job.outputJson` for `youtube-upload` jobs.
- Memory -> Ideation: the memory snapshot now summarizes recent render/publish history and passes it into `generateIdeas()` via `creatorMemorySummary`.
- Result: the loop is credible, incremental, and grounded in the current repo without inventing a new vector database, scheduler, or message bus.

## Gap Analysis

### What already mapped cleanly to agents

- **Trend Discovery Agent**
  Files: `app/api/trends/route.ts`, `lib/rss.ts`, `lib/trends.ts`, `lib/default-sources.ts`, `lib/niche.ts`
  Current reality: the discovery logic already existed as a coherent unit. The main gap was explicit ownership and route-level orchestration.

- **Ideation Agent**
  Files: `app/api/ideas/route.ts`, `lib/ideas.ts`, `lib/storyboard.ts`
  Current reality: idea generation was already encapsulated, including media-led branching and storyboard-assisted media context.

- **Storyboard Agent**
  Files: `app/api/storyboard/route.ts`, `lib/storyboard.ts`, `lib/generated-media.ts`, `lib/editorial.ts`
  Current reality: coverage analysis, beat planning, preview generation, and gating were already cohesive enough to wrap as an agent.

- **Render Agent**
  Files: `app/api/render/route.ts`, `lib/render.ts`, `lib/narration.ts`, `lib/ffmpeg.ts`, `lib/render-storage.ts`
  Current reality: render orchestration already existed, including narration, FFmpeg, generated support media, and persisted outputs.

- **Metadata Agent**
  Files: `app/api/metadata/route.ts`, `lib/metadata.ts`, `lib/schedule.ts`
  Current reality: metadata and schedule generation were already small, tool-backed domain units.

- **Publishing Agent**
  Files: `app/api/youtube/route.ts`, `lib/youtube.ts`, `lib/render-storage.ts`
  Current reality: upload validation and YouTube upload behavior were already isolated enough to become a dedicated agent.

### What was missing for a credible agent system

- **Explicit orchestration logic**
  Files before change: `app/api/trends/route.ts`, `app/api/ideas/route.ts`, `app/api/storyboard/route.ts`, `app/api/render/route.ts`, `app/api/youtube/route.ts`
  Gap: each route stitched together services directly. There was no single workflow state object, no explicit next-step selection, and no visible control handoff.

- **Shared workflow state**
  Files before change: route handlers plus ad hoc function parameters across `lib/ideas.ts`, `lib/storyboard.ts`, and `lib/render.ts`
  Gap: state moved implicitly through request payloads and function arguments instead of a persistent orchestration contract.

- **Memory usage**
  Files before change: `prisma/schema.prisma`, `lib/user.ts`, `lib/jobs.ts`
  Gap: the repo already stored profile and past outputs, but ideation and orchestration did not read them back as memory.

- **Tool abstraction**
  Files before change: direct imports from routes into `lib/rss.ts`, `lib/ideas.ts`, `lib/storyboard.ts`, `lib/render.ts`, `lib/youtube.ts`
  Gap: routes and services called external dependencies directly. There was no intermediate tool layer that an agent could depend on.

- **Feedback loop**
  Files before change: `app/api/youtube/route.ts`, `lib/youtube.ts`, `app/api/ideas/route.ts`, `lib/ideas.ts`
  Gap: publishing outputs were persisted, but later ideation runs never looked at them.

- **Agent-visible status in the frontend**
  Files before change: `app/dashboard/page.tsx`, `app/jobs/[id]/page.tsx`
  Gap: the UI showed job status and raw logs, but not a live view of which agent currently owned the workflow.

## Implementation Plan

### Phase 1 (2-4 hours)

- **Goal**: add minimal multi-agent framing without changing the product surface.
- **Files to create/update**
  - `lib/agents/base-agent.ts`
  - `lib/agents/logs.ts`
  - `lib/agents/orchestrator.ts`
  - `lib/agents/tools.ts`
  - `app/api/trends/route.ts`
  - `app/api/ideas/route.ts`
  - `app/api/storyboard/route.ts`
  - `app/api/render/route.ts`
  - `app/api/metadata/route.ts`
  - `app/api/youtube/route.ts`
  - `README.md`
  - `docs/architecture/creator-pilot-architecture.svg`
  - `docs/architecture/creator-pilot-architecture.jpg`
- **Key interfaces**
  ```ts
  export interface BaseAgent {
    id: string;
    name: string;
    responsibility: string;
    tools: readonly AgentToolName[];
    run(state: AgentWorkflowState, context: AgentRunContext): Promise<Partial<AgentWorkflowState> | void>;
  }
  ```
  ```ts
  export class CreatorPilotOrchestrator {
    runTrendDiscoveryWorkflow(...)
    runIdeaWorkflow(...)
    runStoryboardWorkflow(...)
    runRenderWorkflow(...)
    runMetadataWorkflow(...)
    runPublishingWorkflow(...)
  }
  ```
- **Data flow**
  Route handler -> orchestrator -> specialist agents -> existing lib/ functions -> Prisma/job logs -> UI polling.

### Phase 2 (4-8 hours)

- **Goal**: deepen the behavior so agents operate over richer shared state instead of only wrapping service calls.
- **Files to update**
  - `lib/ideas.ts`
  - `lib/metadata.ts`
  - `lib/agents/memory-agent.ts`
  - `lib/agents/ideation-agent.ts`
  - `lib/agents/storyboard-agent.ts`
  - `lib/agents/render-agent.ts`
  - `components/AgentActivityPanel.tsx`
  - `app/dashboard/page.tsx`
  - `app/jobs/[id]/page.tsx`
- **Function signatures**
  ```ts
  export async function generateIdeas(params: {
    workflow?: "trend" | "media-led";
    creatorMemorySummary?: string | null;
    ...
  }): Promise<IdeaGenerationResult>
  ```
  ```ts
  async loadCreatorMemorySnapshot(user: AgentUserContext): Promise<CreatorMemorySnapshot>
  ```
- **Data flow**
  Memory snapshot -> ideation prompt context -> storyboard/render decisions -> agent log stream -> UI activity panel.

### Phase 3 (optional / advanced)

- **Goal**: make the system more adaptive without breaking the local-first model.
- **Files to create/update**
  - `lib/agents/tools.ts`
  - `lib/agents/orchestrator.ts`
  - `lib/agents/memory-agent.ts`
  - `app/api/jobs/[id]/route.ts`
  - `components/AgentActivityPanel.tsx`
- **Possible additions**
  - Persist lightweight workflow summaries back into `Job.outputJson` for faster replay and comparison.
  - Let the orchestrator choose between trend-led and media-led strategies using memory and recent outputs.
  - Score recent render/publish outcomes and feed that back into ideation prompts or source selection.
- **Data flow**
  Completed jobs -> summarized memory snapshot -> orchestrator policy -> next ideation or discovery run.

## Concrete Code Changes

### New modules

- `lib/agents/base-agent.ts`: shared state and interface contract.
- `lib/agents/tools.ts`: thin tool wrappers over Prisma, RSS, Gemini/Veo, FFmpeg, stored renders, and YouTube upload.
- `lib/agents/orchestrator.ts`: the explicit control plane.

### Example agent implementations

```ts
export class TrendDiscoveryAgent implements BaseAgent {
  readonly id = "trend-discovery-agent";
  readonly name = "Trend Discovery Agent";
  readonly tools = ["prisma", "rss", "gemini-veo"] as const;

  async run(state, context) {
    const sourceState = await context.tools.ensureEnabledSources({ user: context.user });
    const entries = await context.tools.fetchTrendEntries(sourceState.sources.map((source) => source.url));
    const trends = await context.tools.clusterTrendEntries(entries, state.maxTrends ?? 5, context.user.niche);
    return { trends };
  }
}
```

```ts
export class RenderAgent implements BaseAgent {
  readonly id = "render-agent";
  readonly name = "Render Agent";
  readonly tools = ["ffmpeg", "filesystem", "gemini-veo"] as const;

  async run(state, context) {
    const renderOutput = await context.tools.renderVideoVariants({
      userId: context.user.id,
      jobId: state.jobId!,
      title: state.idea!.videoTitle,
      storyboard: state.storyboard!,
      onProgress: (message) => context.log(`[Render Agent] ${message}`),
    });
    const variants = await context.tools.saveRenderVariants({
      userId: context.user.id,
      jobId: state.jobId!,
      variants: renderOutput.variants,
    });
    return { renderOutput: { ...renderOutput, variants } };
  }
}
```

### Orchestrator example

```ts
async runRenderWorkflow(params: {
  user: AgentUserContext;
  jobId: string;
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
```

### API updates

- `app/api/trends/route.ts`: calls `runTrendDiscoveryWorkflow()`
- `app/api/ideas/route.ts`: calls `runIdeaWorkflow()`
- `app/api/storyboard/route.ts`: calls `runStoryboardWorkflow()`
- `app/api/render/route.ts`: uses orchestrator storyboard preflight, then calls `runRenderWorkflow()`
- `app/api/metadata/route.ts`: calls `runMetadataWorkflow()`
- `app/api/youtube/route.ts`: uses tool-layer preflight, then calls `runPublishingWorkflow()`

### Frontend updates

- `components/AgentActivityPanel.tsx`: parses `[Agent]` log lines into a readable live activity panel.
- `app/dashboard/page.tsx`: shows active orchestrator/agent steps during long-running jobs.
- `app/jobs/[id]/page.tsx`: shows the same parsed agent activity alongside raw logs and output JSON.
