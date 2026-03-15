import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  prisma: {
    job: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => dbMock);

import { appendJobLog, createJob, runJobInBackground } from "@/lib/jobs";

describe("jobs", () => {
  beforeEach(() => {
    dbMock.prisma.job.create.mockReset();
    dbMock.prisma.job.findUnique.mockReset();
    dbMock.prisma.job.update.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates queued jobs with timestamped logs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    dbMock.prisma.job.create.mockResolvedValue({ id: "job-1" });

    await createJob({
      userId: "user-1",
      type: "ideas",
      logs: ["Queued idea generation job."],
    });

    const payload = dbMock.prisma.job.create.mock.calls[0]?.[0];
    expect(payload.data.status).toBe("queued");
    expect(JSON.parse(payload.data.logs)).toEqual(["2026-03-15T12:00:00.000Z Queued idea generation job."]);
  });

  it("appends logs even when existing log JSON is invalid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    dbMock.prisma.job.findUnique.mockResolvedValue({ logs: "not-json" });
    dbMock.prisma.job.update.mockResolvedValue({});

    await appendJobLog("job-1", "Started work");

    const payload = dbMock.prisma.job.update.mock.calls[0]?.[0];
    expect(JSON.parse(payload.data.logs)).toEqual(["2026-03-15T12:00:00.000Z Started work"]);
  });

  it("runs jobs to completion and stores task output", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    dbMock.prisma.job.findUnique.mockResolvedValue({ logs: "[]" });
    dbMock.prisma.job.update.mockResolvedValue({});

    const task = vi.fn(async ({ log }: { log: (message: string) => Promise<void> }) => {
      await log("Rendering media");
      return { ok: true };
    });

    await runJobInBackground("job-1", task);
    await vi.runAllTimersAsync();

    expect(task).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.job.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "running" },
    });

    const logUpdate = dbMock.prisma.job.update.mock.calls.find(([payload]) => "logs" in payload.data)?.[0];
    expect(JSON.parse(logUpdate.data.logs)).toEqual(["2026-03-15T12:00:00.000Z Rendering media"]);

    expect(dbMock.prisma.job.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: {
        status: "complete",
        outputJson: '{"ok":true}',
      },
    });
  });

  it("marks failed jobs and normalizes unknown errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    dbMock.prisma.job.findUnique.mockResolvedValue({ logs: JSON.stringify(["existing log"]) });
    dbMock.prisma.job.update.mockResolvedValue({});

    await runJobInBackground("job-1", async () => {
      throw "boom";
    });
    await vi.runAllTimersAsync();

    expect(dbMock.prisma.job.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: {
        status: "failed",
        logs: JSON.stringify(["existing log", "2026-03-15T12:00:00.000Z ERROR: Unknown job error"]),
        outputJson: '{"error":"Unknown job error"}',
      },
    });
  });
});
