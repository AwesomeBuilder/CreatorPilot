import { promises as fsp } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { createRangedFileResponse } from "@/lib/ranged-file-response";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

function isWithinDirectory(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function contentTypeForPath(assetPath: string) {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

async function findAsset(req: Request, context: Params) {
  const user = await resolveUser(req);
  const { id } = await context.params;

  return prisma.mediaAsset.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });
}

async function respondWithAsset(req: Request, context: Params, includeBody: boolean) {
  const asset = await findAsset(req, context);

  if (!asset) {
    return NextResponse.json({ error: "Media asset not found" }, { status: 404 });
  }

  try {
    return await createRangedFileResponse({
      req,
      filePath: asset.path,
      contentType: contentTypeForPath(asset.path),
      includeBody,
    });
  } catch {
    return NextResponse.json({ error: "Media asset is unavailable" }, { status: 404 });
  }
}

export async function GET(req: Request, context: Params) {
  return respondWithAsset(req, context, true);
}

export async function HEAD(req: Request, context: Params) {
  return respondWithAsset(req, context, false);
}

export async function DELETE(req: Request, context: Params) {
  const user = await resolveUser(req);
  const { id } = await context.params;

  const asset = await prisma.mediaAsset.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!asset) {
    return NextResponse.json({ error: "Media asset not found" }, { status: 404 });
  }

  const uploadsRoot = path.resolve(process.cwd(), "uploads", user.id);
  const assetPath = path.resolve(asset.path);

  if (!isWithinDirectory(uploadsRoot, assetPath)) {
    return NextResponse.json({ error: "Media asset path is invalid" }, { status: 400 });
  }

  try {
    await fsp.rm(assetPath, { force: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete media asset file" }, { status: 500 });
  }

  await prisma.mediaAsset.delete({
    where: {
      id: asset.id,
    },
  });

  return NextResponse.json({
    deleted: {
      id: asset.id,
      path: asset.path,
      type: asset.type,
    },
  });
}
