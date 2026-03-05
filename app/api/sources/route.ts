import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const CreateSourceSchema = z.object({
  url: z.string().url(),
});

const UpdateSourceSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export async function GET(req: Request) {
  const user = await resolveUser(req);
  const sources = await prisma.source.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ sources });
}

export async function POST(req: Request) {
  const parsed = CreateSourceSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);

  const source = await prisma.source.create({
    data: {
      userId: user.id,
      url: parsed.data.url,
      enabled: true,
      isCurated: false,
    },
  });

  return NextResponse.json({ source });
}

export async function PATCH(req: Request) {
  const parsed = UpdateSourceSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);

  const source = await prisma.source.updateMany({
    where: {
      id: parsed.data.id,
      userId: user.id,
    },
    data: {
      enabled: parsed.data.enabled,
    },
  });

  return NextResponse.json({ updated: source.count });
}

export async function DELETE(req: Request) {
  const user = await resolveUser(req);
  const id = new URL(req.url).searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing source id." }, { status: 400 });
  }

  await prisma.source.deleteMany({
    where: {
      id,
      userId: user.id,
    },
  });

  return NextResponse.json({ deleted: true });
}
