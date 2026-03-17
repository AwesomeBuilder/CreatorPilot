import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { createStoredRenderResponse } from "@/lib/render-storage";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";
// This endpoint serves per-render files from local disk and must never be prerendered.
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

async function findRender(req: Request, context: Params) {
  const user = await resolveUser(req);
  const { id } = await context.params;

  return prisma.render.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });
}

async function respondWithRender(req: Request, context: Params, includeBody: boolean) {
  const render = await findRender(req, context);

  if (!render) {
    return NextResponse.json({ error: "Render not found" }, { status: 404 });
  }

  try {
    return await createStoredRenderResponse({
      req,
      filePath: render.path,
      contentType: "video/mp4",
      includeBody,
    });
  } catch {
    return NextResponse.json({ error: "Render file is unavailable" }, { status: 404 });
  }
}

export async function GET(req: Request, context: Params) {
  return respondWithRender(req, context, true);
}

export async function HEAD(req: Request, context: Params) {
  return respondWithRender(req, context, false);
}
