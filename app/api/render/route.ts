import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { renderVideoVariants } from "@/lib/render";
import { buildStoryboardPlan, StoryboardPlanSchema, storyboardPlanToAssessment } from "@/lib/storyboard";
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

export async function POST(req: Request) {
  const parsed = InputSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);

  const assets = await prisma.mediaAsset.findMany({
    where: {
      userId: user.id,
      id: {
        in: parsed.data.mediaAssetIds,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (assets.length === 0) {
    return NextResponse.json({ error: "No valid media assets found for rendering." }, { status: 400 });
  }

  const storyboard =
    parsed.data.storyboard ??
    (await buildStoryboardPlan({
      trend: parsed.data.trend,
      idea: parsed.data.idea,
      assets: assets.map((asset) => ({
        id: asset.id,
        path: asset.path,
        type: asset.type as "image" | "video",
      })),
      preference: parsed.data.preference,
    }));

  const assessment = storyboardPlanToAssessment(storyboard);

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

  const selectedAssetIds = new Set(assets.map((asset) => asset.id));
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

  runJobInBackground(job.id, async ({ log }) => {
    await log("Resolving storyboard coverage.");
    await log(`Rendering ${storyboard.beats.length} storyboard beats.`);
    if (storyboard.generatedSupportUsed) {
      await log("Some beats will use generated supporting visuals.");
    }

    const output = await renderVideoVariants({
      userId: user.id,
      jobId: job.id,
      title: parsed.data.idea.videoTitle,
      storyboard,
    });

    await log(`Render format chosen: ${output.format}.`);
    if ((output.generatedVideoBeatCount ?? 0) > 0) {
      await log(`Generated ${output.generatedVideoBeatCount} Veo support clip${output.generatedVideoBeatCount === 1 ? "" : "s"} for uncovered beats.`);
    }
    if ((output.generatedVideoFailureCount ?? 0) > 0) {
      await log(
        `Veo clip generation fell back to still support for ${output.generatedVideoFailureCount} beat${output.generatedVideoFailureCount === 1 ? "" : "s"}.`,
      );
    }
    await log(
      output.audioStatus === "generated"
        ? output.audioComposition?.summary ?? "Generated narration/audio track for the render."
        : `Render completed without narration/audio. ${output.audioError ?? ""}`.trim(),
    );

    await prisma.$transaction(
      output.variants.map((variant) =>
        prisma.render.create({
          data: {
            userId: user.id,
            jobId: job.id,
            variantIndex: variant.variantIndex,
            path: variant.path,
            duration: variant.duration,
          },
        }),
      ),
    );

    await log(`Generated ${output.variants.length} render variants.`);

    return output;
  });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
  });
}
