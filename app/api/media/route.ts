import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  extFromFilename,
  getMediaUploadMode,
  inferMediaMimeType,
  isSupportedMediaFilename,
  markStalePendingMediaAssetsFailed,
  normalizeMediaType,
  reconcileMediaAssetsFromStorage,
  selectPreferredLocalUserRecoveredMediaAssets,
  serializeMediaAsset,
} from "@/lib/media-storage";
import type { MediaAssetRecord } from "@/lib/types";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await resolveUser(req);
  if (getMediaUploadMode() === "direct") {
    const assetCount = await prisma.mediaAsset.count({
      where: { userId: user.id },
    });

    if (assetCount === 0) {
      await reconcileMediaAssetsFromStorage(user.id);
    }
  }

  await markStalePendingMediaAssetsFailed(user.id);
  const assets = await prisma.mediaAsset.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const visibleAssets = selectPreferredLocalUserRecoveredMediaAssets(user.id, assets);

  return NextResponse.json({
    assets: visibleAssets.map((asset) => serializeMediaAsset(asset)),
    uploadMode: getMediaUploadMode(),
  });
}

export async function POST(req: Request) {
  try {
    if (getMediaUploadMode() === "direct") {
      return NextResponse.json({ error: "Direct media uploads are enabled. Create an upload session instead." }, { status: 409 });
    }

    const user = await resolveUser(req);

    const formData = await req.formData();
    const requestedJobId = formData.get("jobId");
    const jobId = typeof requestedJobId === "string" && requestedJobId.trim().length > 0 ? requestedJobId : `manual-${Date.now()}`;

    const fileFields = formData.getAll("files");
    const files =
      fileFields.length > 0
        ? fileFields
        : [...formData.values()].filter((value) => value instanceof File && value.name !== "jobId");

    if (!files.some((value) => value instanceof File)) {
      return NextResponse.json({ error: "No files were provided." }, { status: 400 });
    }

    const uploaded: MediaAssetRecord[] = [];

    const targetDir = path.join(process.cwd(), "uploads", user.id, jobId);
    await fs.mkdir(targetDir, { recursive: true });

    for (const maybeFile of files) {
      if (!(maybeFile instanceof File)) {
        continue;
      }

      if (!isSupportedMediaFilename(maybeFile.name)) {
        return NextResponse.json({ error: `Unsupported file type: ${maybeFile.name}` }, { status: 400 });
      }

      const ext = extFromFilename(maybeFile.name);
      const safeName = `${Date.now()}-${maybeFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const absolutePath = path.join(targetDir, safeName);

      const bytes = await maybeFile.arrayBuffer();
      await fs.writeFile(absolutePath, Buffer.from(bytes));

      const asset = await prisma.mediaAsset.create({
        data: {
          userId: user.id,
          path: absolutePath,
          type: normalizeMediaType(ext),
          status: "ready",
          filename: maybeFile.name,
          mimeType: inferMediaMimeType(maybeFile.name, maybeFile.type),
          sizeBytes: BigInt(maybeFile.size),
        },
      });

      uploaded.push(serializeMediaAsset(asset));
    }

    return NextResponse.json({
      jobId,
      uploaded,
    });
  } catch (error) {
    console.error("Failed to upload media", error);
    return NextResponse.json({ error: "Failed to upload media." }, { status: 500 });
  }
}
