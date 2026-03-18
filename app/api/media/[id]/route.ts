import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { resolveMediaContentType, serializeMediaAsset } from "@/lib/media-storage";
import { createStoredFileResponse, deleteStoredFile, isCloudStoragePath } from "@/lib/storage";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

function isWithinDirectory(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function contentTypeForAsset(asset: { mimeType?: string | null; filename?: string | null; path: string }) {
  return resolveMediaContentType({
    filename: asset.filename,
    mimeType: asset.mimeType,
    path: asset.path,
  });
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

  if (asset.status !== "ready") {
    return NextResponse.json({ error: "Media asset upload is not complete" }, { status: 409 });
  }

  try {
    return await createStoredFileResponse({
      req,
      filePath: asset.path,
      contentType: contentTypeForAsset(asset),
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

  if (!isCloudStoragePath(asset.path)) {
    const uploadsRoot = path.resolve(process.cwd(), "uploads", user.id);
    const assetPath = path.resolve(asset.path);

    if (!isWithinDirectory(uploadsRoot, assetPath)) {
      return NextResponse.json({ error: "Media asset path is invalid" }, { status: 400 });
    }
  }

  try {
    await deleteStoredFile(asset.path, { ignoreMissing: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete media asset file" }, { status: 500 });
  }

  await prisma.mediaAsset.delete({
    where: {
      id: asset.id,
    },
  });

  return NextResponse.json({
    deleted: serializeMediaAsset(asset),
  });
}
