import { NextResponse } from "next/server";
import { z } from "zod";

import { createCreatorPilotOrchestrator } from "@/lib/agents/orchestrator";
import { prisma } from "@/lib/db";
import { appendJobLog, createJob, runJobInBackground } from "@/lib/jobs";
import { StoryboardPlanSchema } from "@/lib/storyboard";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const TrendFitLabelSchema = z.enum(["Direct fit", "Adjacent angle", "Broad news", "Open feed"]);

const InputSchema = z.object({
  trend: z.object({
    trendTitle: z.string().min(1),
    summary: z.string().default(""),
    links: z.array(z.string()).default([]),
    fitLabel: TrendFitLabelSchema.optional(),
    fitReason: z.string().optional(),
  }),
  idea: z.object({
    videoTitle: z.string().min(1),
    hook: z.string().min(1),
    bulletOutline: z.array(z.string()).default([]),
    cta: z.string().min(1),
  }),
  mediaAssetIds: z.array(z.string().min(1)).min(1),
  preference: z.enum(["auto", "shorts", "landscape"]).default("auto"),
  allowIrrelevantMedia: z.boolean().default(false),
  storyboard: StoryboardPlanSchema.optional(),
});

function routeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof SyntaxError) {
    return "Request body must be valid JSON.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

async function runJobInline<T>(
  jobId: string,
  task: (helpers: { log: (message: string) => Promise<void> }) => Promise<T>,
) {
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

    return "complete" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job error";

    await appendJobLog(jobId, `ERROR: ${message}`);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "failed",
        outputJson: JSON.stringify({ error: message }),
      },
    });

    return "failed" as const;
  }
}

export async function POST(req: Request) {
  try {
    const parsed = InputSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const user = await resolveUser(req);
    const orchestrator = createCreatorPilotOrchestrator();
    const preparedState = await orchestrator.runStoryboardWorkflow({
      user,
      input: {
        trend: parsed.data.trend,
        idea: parsed.data.idea,
        mediaAssetIds: parsed.data.mediaAssetIds,
        preference: parsed.data.preference,
        storyboard: parsed.data.storyboard,
      },
    });

    if ((preparedState.selectedMediaAssets?.length ?? 0) === 0) {
      return NextResponse.json({ error: "No valid media assets found for rendering." }, { status: 400 });
    }

    const storyboard = preparedState.storyboard;
    if (!storyboard) {
      throw new Error("Render preparation completed without a storyboard.");
    }

    const assessment = preparedState.assessment;

    if (storyboard.shouldBlock && !parsed.data.allowIrrelevantMedia) {
      return NextResponse.json(
        {
          error: storyboard.coverageSummary,
          assessment,
          storyboard,
        },
        { status: 400 },
      );
    }

    const selectedAssetIds = new Set((preparedState.selectedMediaAssets ?? []).map((asset) => asset.id));
    const userBeatAssetIds = storyboard.beats
      .map((beat) => beat.selectedAssetId)
      .filter((assetId): assetId is string => typeof assetId === "string" && assetId.length > 0);

    if (userBeatAssetIds.some((assetId) => !selectedAssetIds.has(assetId))) {
      return NextResponse.json({ error: "Storyboard references media that is not part of the selected assets." }, { status: 400 });
    }

    const job = await createJob({
      userId: user.id,
      type: "render",
      logs: ["Queued render job."],
    });

    const task = async ({ log }: { log: (message: string) => Promise<void> }) => {
      const state = await orchestrator.runRenderWorkflow({
        user,
        jobId: job.id,
        log,
        input: {
          trend: parsed.data.trend,
          idea: parsed.data.idea,
          mediaAssetIds: parsed.data.mediaAssetIds,
          preference: parsed.data.preference,
          storyboard,
        },
        preparedState,
      });

      if (!state.renderOutput) {
        throw new Error("Render workflow completed without output.");
      }

      return state.renderOutput;
    };

    if (process.env.RUN_RENDER_JOBS_INLINE === "true") {
      const status = await runJobInline(job.id, task);
      return NextResponse.json({
        jobId: job.id,
        status,
      });
    }

    runJobInBackground(job.id, task);

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
    });
  } catch (error) {
    console.error("POST /api/render failed", error);
    const status = error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: routeErrorMessage(error, "Failed to start render.") }, { status });
  }
}
