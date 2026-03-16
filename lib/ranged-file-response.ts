import fs, { promises as fsp } from "node:fs";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

type ByteRange = {
  start: number;
  end: number;
};

type RangedFileResponseOptions = {
  req: Request;
  filePath: string;
  contentType: string;
  includeBody?: boolean;
};

function parseByteRange(rangeHeader: string, fileSize: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || fileSize <= 0) {
    return null;
  }

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) {
    return null;
  }

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : fileSize - 1;

  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start < 0 || requestedEnd < start || start >= fileSize) {
    return null;
  }

  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
}

export async function createRangedFileResponse({
  req,
  filePath,
  contentType,
  includeBody = true,
}: RangedFileResponseOptions) {
  const stats = await fsp.stat(filePath);

  if (stats.size <= 0) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": "inline",
        "Content-Length": "0",
        "Content-Type": contentType,
      },
    });
  }

  const rangeHeader = req.headers.get("range");
  const byteRange = rangeHeader ? parseByteRange(rangeHeader, stats.size) : null;

  if (rangeHeader && !byteRange) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${stats.size}`,
      },
    });
  }

  const start = byteRange?.start ?? 0;
  const end = byteRange?.end ?? stats.size - 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": "inline",
    "Content-Length": String(end - start + 1),
    "Content-Type": contentType,
  });

  if (byteRange) {
    headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
  }

  if (!includeBody) {
    return new NextResponse(null, {
      status: byteRange ? 206 : 200,
      headers,
    });
  }

  const stream = fs.createReadStream(filePath, { start, end });

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: byteRange ? 206 : 200,
    headers,
  });
}
