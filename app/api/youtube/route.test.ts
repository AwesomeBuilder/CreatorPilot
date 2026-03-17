import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  resolveUser: vi.fn(),
  getYoutubeAuthUrl: vi.fn(),
  getYoutubeConnectionStatus: vi.fn(),
  resolveRenderPath: vi.fn(),
  probeStoredRender: vi.fn(),
  runPublishingWorkflow: vi.fn(),
}));

vi.mock("@/lib/agents/tools", () => ({
  createAgentTools: () => ({
    resolveRenderPath: routeMocks.resolveRenderPath,
    probeStoredRender: routeMocks.probeStoredRender,
  }),
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  createCreatorPilotOrchestrator: () => ({
    runPublishingWorkflow: routeMocks.runPublishingWorkflow,
  }),
}));

vi.mock("@/lib/jobs", () => ({
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

vi.mock("@/lib/youtube", () => ({
  getYoutubeAuthUrl: routeMocks.getYoutubeAuthUrl,
  getYoutubeConnectionStatus: routeMocks.getYoutubeConnectionStatus,
}));

import { GET, POST } from "@/app/api/youtube/route";

describe("/api/youtube", () => {
  beforeEach(() => {
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.getYoutubeAuthUrl.mockReset();
    routeMocks.getYoutubeConnectionStatus.mockReset();
    routeMocks.resolveRenderPath.mockReset();
    routeMocks.probeStoredRender.mockReset();
    routeMocks.runPublishingWorkflow.mockReset();
  });

  it("returns connection details and auth URL metadata", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.getYoutubeAuthUrl.mockResolvedValue("https://accounts.example.com/auth");
    routeMocks.getYoutubeConnectionStatus.mockResolvedValue({ connected: false });

    const response = await GET(new Request("http://localhost/api/youtube?action=auth-url"));

    expect(await response.json()).toEqual({
      status: { connected: false },
      authUrl: "https://accounts.example.com/auth",
      canConnect: true,
    });
  });

  it("returns 400 when no render path can be resolved", async () => {
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.resolveRenderPath.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/youtube", {
        method: "POST",
        body: JSON.stringify({
          renderId: "render-1",
          title: "Video title",
          description: "Description",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No render file was provided." });
  });

  it("returns 400 when the selected render has no audio", async () => {
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.resolveRenderPath.mockResolvedValue("/tmp/render.mp4");
    routeMocks.probeStoredRender.mockResolvedValue({ hasAudio: false });

    const response = await POST(
      new Request("http://localhost/api/youtube", {
        method: "POST",
        body: JSON.stringify({
          renderId: "render-1",
          title: "Video title",
          description: "Description",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "This render has no audio track. Generate narration/audio before uploading to YouTube.",
    });
  });

  it("resolves render IDs and uploads in the background task", async () => {
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
      timezone: "America/Los_Angeles",
    });
    routeMocks.resolveRenderPath.mockResolvedValue("/tmp/render.mp4");
    routeMocks.probeStoredRender.mockResolvedValue({ hasAudio: true });
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.runPublishingWorkflow.mockResolvedValue({
      publishResult: {
        mode: "mock",
        url: "https://youtube.example.com/watch?v=123",
      },
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    const response = await POST(
      new Request("http://localhost/api/youtube", {
        method: "POST",
        body: JSON.stringify({
          renderId: "render-1",
          title: "Video title",
          description: "Description",
          tags: ["creator", "news"],
          publishAt: "2026-03-20T00:00:00.000Z",
        }),
      }),
    );

    expect(await response.json()).toEqual({ jobId: "job-1", status: "queued" });

    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(routeMocks.runPublishingWorkflow).toHaveBeenCalledWith({
      user: {
        id: "user-1",
        niche: "AI & Tech",
        tone: "clear",
        timezone: "America/Los_Angeles",
      },
      jobId: "job-1",
      log: expect.any(Function),
      input: {
        renderPath: "/tmp/render.mp4",
        title: "Video title",
        description: "Description",
        tags: ["creator", "news"],
        publishAt: "2026-03-20T00:00:00.000Z",
      },
    });
    expect(result).toEqual({
      mode: "mock",
      url: "https://youtube.example.com/watch?v=123",
    });
  });
});
