import { prisma } from "@/lib/db";

function parseLogArray(input?: string | null): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function logLine(message: string) {
  return `${new Date().toISOString()} ${message}`;
}

export async function createJob(params: { userId: string; type: string; logs?: string[] }) {
  return prisma.job.create({
    data: {
      userId: params.userId,
      type: params.type,
      status: "queued",
      logs: JSON.stringify((params.logs ?? []).map(logLine)),
    },
  });
}

export async function appendJobLog(jobId: string, message: string) {
  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { logs: true } });
  const logs = parseLogArray(existing?.logs);

  logs.push(logLine(message));

  await prisma.job.update({
    where: { id: jobId },
    data: { logs: JSON.stringify(logs) },
  });
}

export async function runJobInBackground<T>(
  jobId: string,
  task: (helpers: { log: (message: string) => Promise<void> }) => Promise<T>,
) {
  setTimeout(async () => {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "running" },
      });

      const output = await task({
        log: async (message) => {
          await appendJobLog(jobId, message);
        },
      });

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "complete",
          outputJson: JSON.stringify(output),
        },
      });
    } catch (error) {
      const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { logs: true } });
      const logs = parseLogArray(existing?.logs);
      const message = error instanceof Error ? error.message : "Unknown job error";
      logs.push(logLine(`ERROR: ${message}`));

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "failed",
          logs: JSON.stringify(logs),
          outputJson: JSON.stringify({ error: message }),
        },
      });
    }
  }, 0);
}

export async function getJobWithRenders(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      renders: {
        orderBy: { variantIndex: "asc" },
      },
    },
  });
}
