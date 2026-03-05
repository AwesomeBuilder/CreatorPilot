import { NextResponse } from "next/server";

import { getJobWithRenders } from "@/lib/jobs";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: Request, context: Params) {
  const { id } = await context.params;

  const job = await getJobWithRenders(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const logs = (() => {
    if (!job.logs) return [];
    try {
      const parsed = JSON.parse(job.logs) as unknown;
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  })();

  const outputJson = (() => {
    if (!job.outputJson) return null;
    try {
      return JSON.parse(job.outputJson);
    } catch {
      return { raw: job.outputJson };
    }
  })();

  return NextResponse.json({
    job: {
      ...job,
      logs,
      outputJson,
    },
  });
}
