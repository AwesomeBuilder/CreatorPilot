import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { generateIdeas } from "@/lib/ideas";
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

  const job = await createJob({
    userId: user.id,
    type: "ideas",
    logs: ["Queued idea generation job."],
  });

  runJobInBackground(job.id, async ({ log }) => {
    const linkedAssets =
      parsed.data.mediaAssetIds.length > 0
        ? await prisma.mediaAsset.findMany({
            where: {
              userId: user.id,
              id: {
                in: parsed.data.mediaAssetIds,
              },
            },
            orderBy: { createdAt: "asc" },
          })
        : [];

    if (workflow === "media-led") {
      await log("Assessing uploaded media and optional brief for media-led idea generation.");
    } else {
      await log("Generating three ideas from selected trend.");
    }

    if (linkedAssets.length > 0) {
      await log(`Linked ${linkedAssets.length} uploaded media asset${linkedAssets.length === 1 ? "" : "s"} into idea generation.`);
    }

    const result =
      workflow === "media-led"
        ? await generateIdeas({
            workflow: "media-led",
            brief: parsed.data.brief,
            niche: user.niche,
            tone: user.tone,
            mediaAssets: linkedAssets.map((asset) => ({
              id: asset.id,
              path: asset.path,
              type: asset.type as "image" | "video",
            })),
          })
        : await generateIdeas({
            workflow: "trend",
            trend: parsed.data.trend!,
            niche: user.niche,
            tone: user.tone,
            mediaAssets: linkedAssets.map((asset) => ({
              id: asset.id,
              path: asset.path,
              type: asset.type as "image" | "video",
            })),
          });

    if (result.generationMode === "needs-brief") {
      await log("Need more text context before a confident media-led angle can be generated.");
    } else if (result.generationMode === "single-plan") {
      await log("Generated one render-ready angle from the uploaded media context.");
    } else {
      await log(`Generated ${result.ideas.length} idea candidate${result.ideas.length === 1 ? "" : "s"}.`);
    }

    await log("Ideas generated successfully.");

    return {
      ...result,
      linkedMediaCount: linkedAssets.length,
      workflow,
    };
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
