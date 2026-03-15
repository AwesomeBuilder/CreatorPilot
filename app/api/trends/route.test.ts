import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  prisma: {
    source: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  createJob: vi.fn(),
  runJobInBackground: vi.fn(),
  fetchRssEntries: vi.fn(),
  clusterEntriesIntoTrends: vi.fn(),
  resolveUser: vi.fn(),
  areSameSourceSets: vi.fn(),
  findMatchingCuratedPreset: vi.fn(),
  getCuratedSourcesForNiche: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: routeMocks.prisma,
}));

vi.mock("@/lib/default-sources", () => ({
  areSameSourceSets: routeMocks.areSameSourceSets,
  findMatchingCuratedPreset: routeMocks.findMatchingCuratedPreset,
  getCuratedSourcesForNiche: routeMocks.getCuratedSourcesForNiche,
}));

vi.mock("@/lib/jobs", () => ({
  createJob: routeMocks.createJob,
  runJobInBackground: routeMocks.runJobInBackground,
}));

vi.mock("@/lib/rss", () => ({
  fetchRssEntries: routeMocks.fetchRssEntries,
}));

vi.mock("@/lib/trends", () => ({
  clusterEntriesIntoTrends: routeMocks.clusterEntriesIntoTrends,
}));

vi.mock("@/lib/user", () => ({
  resolveUser: routeMocks.resolveUser,
}));

import { POST } from "@/app/api/trends/route";

describe("POST /api/trends", () => {
  beforeEach(() => {
    routeMocks.prisma.source.findMany.mockReset();
    routeMocks.prisma.source.createMany.mockReset();
    routeMocks.prisma.source.deleteMany.mockReset();
    routeMocks.prisma.$transaction.mockReset();
    routeMocks.createJob.mockReset();
    routeMocks.runJobInBackground.mockReset();
    routeMocks.fetchRssEntries.mockReset();
    routeMocks.clusterEntriesIntoTrends.mockReset();
    routeMocks.resolveUser.mockReset();
    routeMocks.areSameSourceSets.mockReset();
    routeMocks.findMatchingCuratedPreset.mockReset();
    routeMocks.getCuratedSourcesForNiche.mockReset();
  });

  it("seeds curated sources when the user has none configured", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1", niche: "AI & Tech" });
    routeMocks.prisma.source.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { url: "https://feed.example.com/a", enabled: true },
        { url: "https://feed.example.com/b", enabled: true },
      ]);
    routeMocks.getCuratedSourcesForNiche.mockReturnValue(["https://feed.example.com/a", "https://feed.example.com/b"]);
    routeMocks.findMatchingCuratedPreset.mockReturnValue(null);
    routeMocks.fetchRssEntries.mockResolvedValue([
      {
        title: "Trend",
        link: "https://example.com/trend",
        snippet: "Snippet",
        sourceUrl: "https://feed.example.com/a",
      },
    ]);
    routeMocks.clusterEntriesIntoTrends.mockResolvedValue([{ trendTitle: "AI trend" }]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    const response = await POST(new Request("http://localhost/api/trends", { method: "POST" }));

    expect(await response.json()).toEqual({ jobId: "job-1", status: "queued" });

    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(routeMocks.prisma.source.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", url: "https://feed.example.com/a", enabled: true, isCurated: true },
        { userId: "user-1", url: "https://feed.example.com/b", enabled: true, isCurated: true },
      ],
    });
    expect(routeMocks.fetchRssEntries).toHaveBeenCalledWith(["https://feed.example.com/a", "https://feed.example.com/b"]);
    expect(result).toEqual({
      trends: [{ trendTitle: "AI trend" }],
      sourceCount: 2,
      entryCount: 1,
      sourceSyncNote: null,
    });
  });

  it("syncs stale curated sources to the current niche before fetching feeds", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1", niche: "Creator Economy" });
    routeMocks.prisma.source.findMany
      .mockResolvedValueOnce([
        { url: "https://old.example.com/a", enabled: true },
        { url: "https://old.example.com/b", enabled: true },
      ])
      .mockResolvedValueOnce([
        { url: "https://new.example.com/a", enabled: true },
        { url: "https://new.example.com/b", enabled: true },
      ]);
    routeMocks.getCuratedSourcesForNiche.mockReturnValue(["https://new.example.com/a", "https://new.example.com/b"]);
    routeMocks.findMatchingCuratedPreset.mockReturnValue("Business & Finance");
    routeMocks.areSameSourceSets.mockReturnValue(false);
    routeMocks.fetchRssEntries.mockResolvedValue([
      {
        title: "Trend",
        link: "https://example.com/trend",
        snippet: "Snippet",
        sourceUrl: "https://new.example.com/a",
      },
    ]);
    routeMocks.clusterEntriesIntoTrends.mockResolvedValue([{ trendTitle: "Creator trend" }]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    await POST(new Request("http://localhost/api/trends", { method: "POST" }));
    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(routeMocks.prisma.source.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(routeMocks.prisma.source.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", url: "https://new.example.com/a", enabled: true, isCurated: true },
        { userId: "user-1", url: "https://new.example.com/b", enabled: true, isCurated: true },
      ],
    });
    expect(routeMocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      trends: [{ trendTitle: "Creator trend" }],
      sourceCount: 2,
      entryCount: 1,
      sourceSyncNote: "Curated feeds were refreshed to match Creator Economy.",
    });
  });

  it("returns an empty trend list when feeds produce no entries", async () => {
    routeMocks.createJob.mockResolvedValue({ id: "job-1", status: "queued" });
    routeMocks.resolveUser.mockResolvedValue({ id: "user-1", niche: "AI & Tech" });
    routeMocks.prisma.source.findMany.mockResolvedValue([{ url: "https://feed.example.com/a", enabled: true }]);
    routeMocks.getCuratedSourcesForNiche.mockReturnValue(["https://feed.example.com/a"]);
    routeMocks.findMatchingCuratedPreset.mockReturnValue(null);
    routeMocks.fetchRssEntries.mockResolvedValue([]);

    let backgroundTask:
      | ((helpers: { log: (message: string) => Promise<void> }) => Promise<unknown>)
      | undefined;

    routeMocks.runJobInBackground.mockImplementation((_: string, task: typeof backgroundTask) => {
      backgroundTask = task;
    });

    await POST(new Request("http://localhost/api/trends", { method: "POST" }));
    const result = await backgroundTask?.({ log: vi.fn().mockResolvedValue(undefined) });

    expect(routeMocks.clusterEntriesIntoTrends).not.toHaveBeenCalled();
    expect(result).toEqual({ trends: [] });
  });
});
