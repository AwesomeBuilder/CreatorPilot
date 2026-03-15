import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  generateIdeas: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/ideas", () => ({
  generateIdeas: routeMocks.generateIdeas,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/ideas/route";

describe("POST /api/ideas", () => {
  beforeEach(() => {
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.generateIdeas.mockReset();
    routeMocks.resolveUser.mockReset();
  });

  it("returns 400 for invalid requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          trend: {
            trendTitle: "",
            summary: "",
            links: ["not-a-url"],
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("queues idea generation and passes the selected trend plus user preferences into the task", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({
      id: "user-1",
      niche: "AI & Tech",
      tone: "clear",
    });

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    routeMocks.generateIdeas.mockResolvedValue([
      {
        videoTitle: "Idea 1",
        hook: "Hook 1",
        bulletOutline: ["One", "Two", "Three"],
        cta: "CTA 1",
      },
    ]);

    const trend = {
      trendTitle: "OpenAI launches new developer tooling",
      summary: "A new platform update is out.",
      links: ["https://example.com/trend"],
      fitLabel: "Direct fit" as const,
    };

    const response = await POST(
      new Request("http://localhost/api/ideas", {
        method: "POST",
        body: JSON.stringify({ trend }),
      }),
    );

    expect(await response.json()).toEqual({ jobId: "job-1", status: "queued" });
    expect(backgroundTask).toBeTypeOf("function");

    const log = vi.fn().mockResolvedValue(undefined);
    const result = await backgroundTask?.({ log });

    expect(routeMocks.generateIdeas).toHaveBeenCalledWith({
      trend,
      niche: "AI & Tech",
      tone: "clear",
    });
    expect(log).toHaveBeenCalledWith("Generating three ideas from selected trend.");
    expect(result).toEqual({
      ideas: [
        {
          videoTitle: "Idea 1",
          hook: "Hook 1",
          bulletOutline: ["One", "Two", "Three"],
          cta: "CTA 1",
        },
      ],
    });
  });
});
