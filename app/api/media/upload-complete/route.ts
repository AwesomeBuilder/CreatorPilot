import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { serializeMediaAsset } from "@/lib/media-storage";
import { getStoredFileMetadata } from "@/lib/storage";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const InputSchema = z.object({
  assetId: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = InputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);
  const asset = await prisma.mediaAsset.findFirst({
    where: {
      id: parsed.data.assetId,
      userId: user.id,
    },
  });

  if (!asset) {
    return NextResponse.json({ error: "Media asset not found" }, { status: 404 });
  }

  const metadata = await getStoredFileMetadata(asset.path);
  if (!metadata.exists) {
    const failedAsset = await prisma.mediaAsset.update({
      where: {
        id: asset.id,
      },
      data: {
        status: "failed",
      },
    });

    return NextResponse.json(
      {
        error: "Uploaded media object was not found.",
        asset: serializeMediaAsset(failedAsset),
      },
      { status: 409 },
    );
  }

  const completedAsset = await prisma.mediaAsset.update({
    where: {
      id: asset.id,
    },
    data: {
      status: "ready",
      mimeType: metadata.contentType ?? asset.mimeType,
      sizeBytes: typeof metadata.sizeBytes === "number" ? BigInt(metadata.sizeBytes) : asset.sizeBytes,
    },
  });

  return NextResponse.json({
    asset: serializeMediaAsset(completedAsset),
  });
}
