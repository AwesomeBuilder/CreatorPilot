import { NextResponse } from "next/server";
import { z } from "zod";

import { createJob, runJobInBackground } from "@/lib/jobs";
import { generateIdeas } from "@/lib/ideas";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const InputSchema = z.object({
  trend: z.object({
    trendTitle: z.string().min(1),
    summary: z.string().min(1),
    links: z.array(z.string().url()).default([]),
    fitLabel: z.enum(["Direct fit", "Adjacent angle", "Broad news", "Open feed"]).optional(),
    fitReason: z.string().optional(),
  }),
});

export async function POST(req: Request) {
  const parsed = InputSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);

  const job = await createJob({
    userId: user.id,
    type: "ideas",
    logs: ["Queued idea generation job."],
  });

  runJobInBackground(job.id, async ({ log }) => {
    await log("Generating three ideas from selected trend.");
    const ideas = await generateIdeas({
      trend: parsed.data.trend,
      niche: user.niche,
      tone: user.tone,
    });

    await log("Ideas generated successfully.");
    return { ideas };
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
