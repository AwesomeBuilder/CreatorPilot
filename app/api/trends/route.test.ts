import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  resolveUser: vi.fn(),
  runTrendDiscoveryWorkflow: vi.fn(),
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  createCreatorPilotOrchestrator: () => ({
    runTrendDiscoveryWorkflow: routeMocks.runTrendDiscoveryWorkflow,
  }),
}));

vi.mock("@/lib/jobs", () => ({
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/trends/route";

describe("POST /api/trends", () => {
  beforeEach(() => {
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.runTrendDiscoveryWorkflow.mockReset();
  });

  it("queues trend discovery and delegates the background work to the orchestrator", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.runTrendDiscoveryWorkflow.mockResolvedValue({
      trends: [{ trendTitle: "AI trend" }],
      trendDiscovery: {
        sourceCount: 2,
        entryCount: 14,
        sourceSyncNote: "Curated feeds were refreshed to match AI & Tech.",
      },
    });

    const response = await POST(new Request("http://localhost/api/trends", { method: "POST" }));

    expect(await response.json()).toEqual({ jobId: "job-1", status: "queued" });

    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(routeMocks.runTrendDiscoveryWorkflow).toHaveBeenCalledWith({
      user: {
        id: "user-1",
        niche: "AI & Tech",
        tone: "clear",
        timezone: "America/Los_Angeles",
      },
      jobId: "job-1",
      log: expect.any(Function),
      maxTrends: 5,
    });
    expect(result).toEqual({
      trends: [{ trendTitle: "AI trend" }],
      sourceCount: 2,
      entryCount: 14,
      sourceSyncNote: "Curated feeds were refreshed to match AI & Tech.",
    });
  });

  it("returns an empty trend list when the orchestrator returns no candidates", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-2", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: null,
      tone: null,
      timezone: "America/Los_Angeles",
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.runTrendDiscoveryWorkflow.mockResolvedValue({
      trends: [],
      trendDiscovery: {
        sourceCount: 0,
        entryCount: 0,
        sourceSyncNote: null,
      },
    });

    await POST(new Request("http://localhost/api/trends", { method: "POST" }));
    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(result).toEqual({
      trends: [],
      sourceCount: 0,
      entryCount: 0,
      sourceSyncNote: null,
    });
  });
});
