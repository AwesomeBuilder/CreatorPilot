import { NextResponse } from "next/server";
import { z } from "zod";

import { createCreatorPilotOrchestrator } from "@/lib/agents/orchestrator";
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

function routeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof SyntaxError) {
    return "Request body must be valid JSON.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export async function POST(req: Request) {
  try {
    const parsed = InputSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const user = await resolveUser(req);
    const orchestrator = createCreatorPilotOrchestrator();
    const state = await orchestrator.runStoryboardWorkflow({
      user,
      input: {
        trend: parsed.data.trend,
        idea: parsed.data.idea,
        mediaAssetIds: parsed.data.mediaAssetIds,
        preference: parsed.data.preference,
      },
    });

    if (!state.storyboard) {
      throw new Error("Storyboard workflow completed without a storyboard.");
    }

    return NextResponse.json({
      storyboard: state.storyboard,
      assessment: state.assessment,
    });
  } catch (error) {
    console.error("POST /api/storyboard failed", error);
    const status =
      error instanceof SyntaxError || (error instanceof Error && error.message === "No valid media assets found for storyboarding.")
        ? 400
        : 500;
    return NextResponse.json({ error: routeErrorMessage(error, "Failed to analyze coverage.") }, { status });
  }
}
