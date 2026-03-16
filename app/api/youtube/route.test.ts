import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    render: {
      findFirst: vi.fn(),
    },
  },
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  resolveUser: vi.fn(),
  getYoutubeAuthUrl: vi.fn(),
  getYoutubeConnectionStatus: vi.fn(),
  uploadVideoToYoutube: vi.fn(),
  probeMedia: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
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
  uploadVideoToYoutube: routeMocks.uploadVideoToYoutube,
}));

vi.mock("@/lib/ffmpeg", () => ({
  probeMedia: routeMocks.probeMedia,
}));

import { GET, POST } from "@/app/api/youtube/route";

describe("/api/youtube", () => {
  beforeEach(() => {
    routeMocks.prisma.render.findFirst.mockReset();
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.getYoutubeAuthUrl.mockReset();
    routeMocks.getYoutubeConnectionStatus.mockReset();
    routeMocks.uploadVideoToYoutube.mockReset();
    routeMocks.probeMedia.mockReset();
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
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.render.findFirst.mockResolvedValue(null);

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

  it("resolves render IDs and uploads in the background task", async () => {
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1" });
    routeMocks.prisma.render.findFirst.mockResolvedValue({ path: "/tmp/render.mp4" });
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.uploadVideoToYoutube.mockResolvedValue({
      mode: "mock",
      url: "https://youtube.example.com/watch?v=123",
    });
    routeMocks.probeMedia.mockResolvedValue({ hasAudio: true });

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

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(routeMocks.uploadVideoToYoutube).toHaveBeenCalledWith({
      userId: "user-1",
      videoPath: "/tmp/render.mp4",
      title: "Video title",
      description: "Description",
      tags: ["creator", "news"],
      publishAt: "2026-03-20T00:00:00.000Z",
    });
    expect(log).toHaveBeenCalledWith("Uploading rendered video to YouTube.");
    expect(result).toEqual({
      mode: "mock",
      url: "https://youtube.example.com/watch?v=123",
    });
  });
});
