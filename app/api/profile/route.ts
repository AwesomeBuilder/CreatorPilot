import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { getCuratedSourcesForNiche } from "@/lib/default-sources";
import { NICHE_VALUES, TIMEZONE_VALUES } from "@/lib/profile-options";
import { resolveUser } from "@/lib/user";
import { getYoutubeConnectionStatus } from "@/lib/youtube";

export const runtime = "nodejs";

function trimEmptyToNull(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const ProfileInput = z.object({
  niche: z.preprocess(trimEmptyToNull, z.enum(NICHE_VALUES).nullable().optional()),
  tone: z.preprocess(trimEmptyToNull, z.string().min(1).nullable().optional()),
  timezone: z.preprocess(trimEmptyToNull, z.enum(TIMEZONE_VALUES).optional()),
  sources: z.array(z.string().url()).optional(),
});

export async function GET(req: Request) {
  const user = await resolveUser(req);
  const sources = await prisma.source.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const youtube = await getYoutubeConnectionStatus(user.id);

  return NextResponse.json({ user, sources, youtube });
}

export async function POST(req: Request) {
  const parsed = ProfileInput.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      niche: parsed.data.niche === undefined ? undefined : parsed.data.niche,
      tone: parsed.data.tone === undefined ? undefined : parsed.data.tone,
      timezone: parsed.data.timezone === undefined ? undefined : parsed.data.timezone,
    },
  });

  const explicitSources = [...new Set(parsed.data.sources ?? [])];

  if (parsed.data.sources) {
    await prisma.source.deleteMany({ where: { userId: user.id } });

    if (explicitSources.length > 0) {
      await prisma.source.createMany({
        data: explicitSources.map((url) => ({
          userId: user.id,
          url,
          enabled: true,
          isCurated: false,
        })),
      });
    } else {
      const curated = getCuratedSourcesForNiche(updatedUser.niche);
      await prisma.source.createMany({
        data: curated.map((url) => ({
          userId: user.id,
          url,
          enabled: true,
          isCurated: true,
        })),
      });
    }
  } else {
    const sourceCount = await prisma.source.count({ where: { userId: user.id } });

    if (sourceCount === 0) {
      const curated = getCuratedSourcesForNiche(updatedUser.niche);
      await prisma.source.createMany({
        data: curated.map((url) => ({
          userId: user.id,
          url,
          enabled: true,
          isCurated: true,
        })),
      });
    }
  }

  const sources = await prisma.source.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  const youtube = await getYoutubeConnectionStatus(user.id);

  return NextResponse.json({ user: updatedUser, sources, youtube });
}
