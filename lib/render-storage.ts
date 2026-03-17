import fs, { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { Storage } from "@google-cloud/storage";
import { NextResponse } from "next/server";

import { createRangedFileResponse } from "@/lib/ranged-file-response";

type ByteRange = {
  start: number;
  end: number;
};

const RENDER_STORAGE_BUCKET = process.env.RENDER_STORAGE_BUCKET?.trim() || null;

let storageClient: Storage | null = null;

function getStorageClient() {
  if (!storageClient) {
    storageClient = new Storage();
  }

  return storageClient;
}

export function getRenderStorageBucket() {
  return RENDER_STORAGE_BUCKET;
}

export function isCloudStoragePath(filePath: string) {
  return filePath.startsWith("gs://");
}

function parseCloudStoragePath(filePath: string) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(filePath);
  if (!match) {
    throw new Error(`Invalid Cloud Storage path: ${filePath}`);
  }

  return {
    bucketName: match[1],
    objectName: match[2],
  };
}

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

type StoredRenderVariant = {
  variantIndex: number;
  path: string;
  duration: number;
  hasAudio?: boolean;
  audioSummary?: string;
};

export async function persistRenderVariants(params: {
  userId: string;
  jobId: string;
  variants: StoredRenderVariant[];
}) {
  if (!RENDER_STORAGE_BUCKET) {
    return params.variants;
  }

  const storage = getStorageClient();
  const bucket = storage.bucket(RENDER_STORAGE_BUCKET);

  const persistedVariants = await Promise.all(
    params.variants.map(async (variant) => {
      const objectName = path.posix.join("renders", params.userId, params.jobId, `variant-${variant.variantIndex}.mp4`);
      await bucket.upload(variant.path, {
        destination: objectName,
        resumable: false,
        metadata: {
          contentType: "video/mp4",
          cacheControl: "no-store",
        },
      });

      return {
        ...variant,
        path: `gs://${RENDER_STORAGE_BUCKET}/${objectName}`,
      };
    }),
  );

  return persistedVariants;
}

async function createCloudStorageResponse(params: {
  req: Request;
  filePath: string;
  contentType: string;
  includeBody?: boolean;
}) {
  const { bucketName, objectName } = parseCloudStoragePath(params.filePath);
  const file = getStorageClient().bucket(bucketName).file(objectName);
  const [metadata] = await file.getMetadata();
  const fileSize = Number(metadata.size ?? 0);

  if (!Number.isFinite(fileSize)) {
    throw new Error("Cloud Storage object metadata is invalid.");
  }

  if (fileSize <= 0) {
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": "inline",
        "Content-Length": "0",
        "Content-Type": params.contentType,
      },
    });
  }

  const rangeHeader = params.req.headers.get("range");
  const byteRange = rangeHeader ? parseByteRange(rangeHeader, fileSize) : null;

  if (rangeHeader && !byteRange) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${fileSize}`,
      },
    });
  }

  const start = byteRange?.start ?? 0;
  const end = byteRange?.end ?? fileSize - 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": "inline",
    "Content-Length": String(end - start + 1),
    "Content-Type": params.contentType,
  });

  if (byteRange) {
    headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  }

  if (!params.includeBody) {
    return new NextResponse(null, {
      status: byteRange ? 206 : 200,
      headers,
    });
  }

  const stream = file.createReadStream({ start, end });

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: byteRange ? 206 : 200,
    headers,
  });
}

export async function createStoredRenderResponse(params: {
  req: Request;
  filePath: string;
  contentType: string;
  includeBody?: boolean;
}) {
  if (!isCloudStoragePath(params.filePath)) {
    return createRangedFileResponse(params);
  }

  return createCloudStorageResponse(params);
}

type LocalRenderHandle = {
  localPath: string;
  cleanup: () => Promise<void>;
};

async function downloadCloudStorageObject(filePath: string): Promise<LocalRenderHandle> {
  const { bucketName, objectName } = parseCloudStoragePath(filePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "creator-pilot-render-"));
  const localPath = path.join(tempDir, path.basename(objectName));
  await getStorageClient().bucket(bucketName).file(objectName).download({ destination: localPath });

  return {
    localPath,
    cleanup: async () => {
      await fsp.rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function withLocalRenderPath<T>(filePath: string, fn: (localPath: string) => Promise<T>) {
  if (!isCloudStoragePath(filePath)) {
    return fn(filePath);
  }

  const handle = await downloadCloudStorageObject(filePath);

  try {
    return await fn(handle.localPath);
  } finally {
    await handle.cleanup();
  }
}

export async function renderFileExists(filePath: string) {
  if (!isCloudStoragePath(filePath)) {
    try {
      await fsp.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  const { bucketName, objectName } = parseCloudStoragePath(filePath);
  const [exists] = await getStorageClient().bucket(bucketName).file(objectName).exists();
  return exists;
}
