import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { assessMediaRelevance } from "@/lib/media-relevance";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { renderVideoVariants } from "@/lib/render";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const InputSchema = z.object({
  idea: z.object({
    videoTitle: z.string().min(1),
    hook: z.string().min(1),
    bulletOutline: z.array(z.string()).default([]),
    cta: z.string().min(1),
  }),
  mediaAssetIds: z.array(z.string().min(1)).min(1),
  preference: z.enum(["auto", "shorts", "landscape"]).default("auto"),
  allowIrrelevantMedia: z.boolean().default(false),
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

  const assessment = await assessMediaRelevance({
    idea: parsed.data.idea,
    assets: assets.map((asset) => ({
      path: asset.path,
      type: asset.type,
    })),
  });

  if (assessment.shouldBlock && !parsed.data.allowIrrelevantMedia) {
    return NextResponse.json(
      {
        error: assessment.summary,
        assessment,
      },
      { status: 400 },
    );
  }

  const job = await createJob({
    userId: user.id,
    type: "render",
    logs: ["Queued render job."],
  });

  runJobInBackground(job.id, async ({ log }) => {
    await log("Resolving media assets.");

    await log(`Rendering using ${assets.length} selected assets.`);

    const output = await renderVideoVariants({
      userId: user.id,
      jobId: job.id,
      mediaPaths: assets.map((asset) => asset.path),
      title: parsed.data.idea.videoTitle,
      hook: parsed.data.idea.hook,
      bulletOutline: parsed.data.idea.bulletOutline,
      cta: parsed.data.idea.cta,
      preference: parsed.data.preference,
    });

    await log(`Render format chosen: ${output.format}.`);

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

    await log("Generated 3 render variants.");

    return output;
  });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
  });
}
