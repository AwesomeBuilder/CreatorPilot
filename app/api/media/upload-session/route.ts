import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  createMediaAssetId,
  getMediaStorageBucket,
  getMediaUploadMode,
  inferMediaMimeType,
  isSupportedMediaFilename,
  mediaObjectName,
  mediaStoragePath,
  normalizeMediaType,
  requestOrigin,
  serializeMediaAsset,
} from "@/lib/media-storage";
import { createCloudStorageResumableUploadSession } from "@/lib/storage";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const InputSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().positive(),
  jobId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  let createdAssetId: string | null = null;

  try {
    if (getMediaUploadMode() !== "direct") {
      return NextResponse.json({ error: "Direct uploads are not configured for this environment." }, { status: 409 });
    }

    const parsed = InputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const bucketName = getMediaStorageBucket();
    if (!bucketName) {
      return NextResponse.json({ error: "Media storage bucket is not configured." }, { status: 500 });
    }

    if (!isSupportedMediaFilename(parsed.data.filename)) {
      return NextResponse.json({ error: `Unsupported file type: ${parsed.data.filename}` }, { status: 400 });
    }

    const user = await resolveUser(req);
    const assetId = createMediaAssetId();
    const mimeType = inferMediaMimeType(parsed.data.filename, parsed.data.mimeType);
    const ext = parsed.data.filename.split(".").pop()?.toLowerCase() ?? "";
    const objectName = mediaObjectName({
      userId: user.id,
      assetId,
      filename: parsed.data.filename,
    });

    const asset = await prisma.mediaAsset.create({
      data: {
        id: assetId,
        userId: user.id,
        path: mediaStoragePath({
          bucketName,
          userId: user.id,
          assetId,
          filename: parsed.data.filename,
        }),
        type: normalizeMediaType(ext),
        status: "pending",
        filename: parsed.data.filename,
        mimeType,
        sizeBytes: BigInt(parsed.data.sizeBytes),
      },
    });
    createdAssetId = asset.id;

    const uploadUrl = await createCloudStorageResumableUploadSession({
      bucketName,
      objectName,
      contentType: mimeType,
      origin: requestOrigin(req),
      metadata: {
        mediaAssetId: asset.id,
        userId: user.id,
      },
    });

    return NextResponse.json({
      assetId: asset.id,
      uploadUrl,
      asset: serializeMediaAsset(asset),
    });
  } catch (error) {
    console.error("Failed to create media upload session", error);

    if (createdAssetId) {
      await prisma.mediaAsset
        .update({
          where: {
            id: createdAssetId,
          },
          data: {
            status: "failed",
          },
        })
        .catch(() => undefined);
    }

    return NextResponse.json({ error: "Failed to create upload session." }, { status: 500 });
  }
}
