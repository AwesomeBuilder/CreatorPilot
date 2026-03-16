import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

function contentTypeForPath(assetPath: string) {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

function parseByteRange(rangeHeader: string, fileSize: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  const [, startRaw, endRaw] = match;
  const start = startRaw ? Number(startRaw) : 0;
  const end = endRaw ? Number(endRaw) : fileSize - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= fileSize) {
    return null;
  }

  return { start, end };
}

export async function GET(req: Request, context: Params) {
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

  try {
    const stats = await fsp.stat(asset.path);
    const rangeHeader = req.headers.get("range");
    const byteRange = rangeHeader ? parseByteRange(rangeHeader, stats.size) : null;

    if (rangeHeader && !byteRange) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${stats.size}`,
        },
      });
    }

    const start = byteRange?.start ?? 0;
    const end = byteRange?.end ?? stats.size - 1;
    const stream = fs.createReadStream(asset.path, { start, end });

    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: byteRange ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": "inline",
        "Content-Length": String(end - start + 1),
        "Content-Range": byteRange ? `bytes ${start}-${end}/${stats.size}` : "",
        "Content-Type": contentTypeForPath(asset.path),
      },
    });
  } catch {
    return NextResponse.json({ error: "Media asset is unavailable" }, { status: 404 });
  }
}
