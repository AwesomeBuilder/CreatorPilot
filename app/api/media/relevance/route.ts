import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { assessMediaRelevance } from "@/lib/media-relevance";
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

  const assessment = await assessMediaRelevance({
    idea: parsed.data.idea,
    assets: assets.map((asset) => ({
      path: asset.path,
      type: asset.type,
    })),
  });

  return NextResponse.json({ assessment });
}
