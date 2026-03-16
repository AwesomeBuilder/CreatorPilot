import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveRequestedMediaAssets } from "@/lib/media-assets";
import { buildStoryboardPlan, hydrateStoryboardGeneratedPreviews, storyboardPlanToAssessment } from "@/lib/storyboard";
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
});

export async function POST(req: Request) {
  const parsed = InputSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);

  const assets = await resolveRequestedMediaAssets({
    userId: user.id,
    mediaReferences: parsed.data.mediaAssetIds,
  });

  if (assets.length === 0) {
    return NextResponse.json({ error: "No valid media assets found for storyboarding." }, { status: 400 });
  }

  const baseStoryboard = await buildStoryboardPlan({
    trend: parsed.data.trend,
    idea: parsed.data.idea,
    assets: assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      type: asset.type as "image" | "video",
    })),
    preference: parsed.data.preference,
  });
  const storyboard = await hydrateStoryboardGeneratedPreviews({
    userId: user.id,
    scopeId: `storyboard-${Date.now()}`,
    storyboard: baseStoryboard,
  });

  return NextResponse.json({
    storyboard,
    assessment: storyboardPlanToAssessment(storyboard),
  });
}
