import { NextResponse } from "next/server";
import { z } from "zod";

import { createCreatorPilotOrchestrator } from "@/lib/agents/orchestrator";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const TrendSchema = z.object({
  trendTitle: z.string().min(1),
  summary: z.string().min(1),
  links: z.array(z.string().url()).default([]),
  fitLabel: z.enum(["Direct fit", "Adjacent angle", "Broad news", "Open feed"]).optional(),
  fitReason: z.string().optional(),
});

const RawInputSchema = z
  .object({
    workflow: z.enum(["trend", "media-led"]).optional(),
    trend: TrendSchema.optional(),
    mediaAssetIds: z.array(z.string().min(1)).default([]),
    brief: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const workflow = value.workflow ?? "trend";

    if (workflow === "trend" && !value.trend) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trend is required for trend workflow",
        path: ["trend"],
      });
    }

    if (workflow === "media-led" && value.mediaAssetIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mediaAssetIds must include at least one asset for media-led workflow",
        path: ["mediaAssetIds"],
      });
    }
  });

export async function POST(req: Request) {
  const parsed = RawInputSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const workflow = parsed.data.workflow ?? "trend";
  const user = await resolveUser(req);
  const orchestrator = createCreatorPilotOrchestrator();

  const job = await createJob({
    userId: user.id,
    type: "ideas",
    logs: ["Queued idea generation job."],
  });

  runJobInBackground(job.id, async ({ log }) => {
    const state = await orchestrator.runIdeaWorkflow({
      user,
      jobId: job.id,
      log,
      input: {
        workflow,
        trend: parsed.data.trend,
        mediaAssetIds: parsed.data.mediaAssetIds,
        brief: parsed.data.brief,
      },
    });

    const result = state.ideasResult;
    if (!result) {
      throw new Error("Idea workflow completed without a result.");
    }

    return {
      ...result,
      linkedMediaCount: state.selectedMediaAssets?.length ?? 0,
      workflow,
    };
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
