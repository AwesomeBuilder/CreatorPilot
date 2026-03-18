import fs, { promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
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

export type StoredFileMetadata = {
  contentType: string | null;
  exists: boolean;
  sizeBytes: number | null;
  updatedAt: string | null;
};

export type StoredFileBinaryInput = {
  inputArgs?: string[];
  inputPath: string;
};

let storageClient: Storage | null = null;

export function getStorageClient() {
  if (!storageClient) {
    storageClient = new Storage();
  }

  return storageClient;
}

export function isCloudStoragePath(filePath: string) {
  return filePath.startsWith("gs://");
}

export function parseCloudStoragePath(filePath: string) {
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

export async function createStoredFileResponse(params: {
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

export async function resolveStoredFileBinaryInput(filePath: string): Promise<StoredFileBinaryInput> {
  if (!isCloudStoragePath(filePath)) {
    return {
      inputPath: filePath,
    };
  }

  const accessToken = await getStorageClient().authClient.getAccessToken();
  if (!accessToken) {
    throw new Error("Failed to obtain a Cloud Storage access token.");
  }

  const { bucketName, objectName } = parseCloudStoragePath(filePath);
  return {
    inputArgs: ["-headers", `Authorization: Bearer ${accessToken}\r\n`],
    inputPath: `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectName)}?alt=media`,
  };
}

function localTempFilename(filePath: string) {
  const basename = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";
  const hash = createHash("sha1").update(filePath).digest("hex").slice(0, 10);
  return `${hash}-${basename}`;
}

export async function materializeStoredFile(params: {
  filePath: string;
  tempDir: string;
  cache?: Map<string, string>;
}) {
  if (!isCloudStoragePath(params.filePath)) {
    return params.filePath;
  }

  const cached = params.cache?.get(params.filePath);
  if (cached) {
    return cached;
  }

  const { bucketName, objectName } = parseCloudStoragePath(params.filePath);
  const localPath = path.join(params.tempDir, localTempFilename(objectName));
  await getStorageClient().bucket(bucketName).file(objectName).download({ destination: localPath });
  params.cache?.set(params.filePath, localPath);
  return localPath;
}

export async function resolveStoredFileReadUrl(params: {
  filePath: string;
  expiresMs?: number;
}) {
  if (!isCloudStoragePath(params.filePath)) {
    return params.filePath;
  }

  const { bucketName, objectName } = parseCloudStoragePath(params.filePath);
  const [signedUrl] = await getStorageClient()
    .bucket(bucketName)
    .file(objectName)
    .getSignedUrl({
      action: "read",
      expires: Date.now() + (params.expiresMs ?? 15 * 60 * 1000),
      version: "v4",
    });

  return signedUrl;
}

type LocalStoredFileHandle = {
  cleanup: () => Promise<void>;
  localPath: string;
};

async function downloadCloudStorageObject(filePath: string): Promise<LocalStoredFileHandle> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "creator-pilot-storage-"));
  const localPath = await materializeStoredFile({
    filePath,
    tempDir,
  });

  return {
    localPath,
    cleanup: async () => {
      await fsp.rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function withLocalStoredFilePath<T>(filePath: string, fn: (localPath: string) => Promise<T>) {
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

export async function storedFileExists(filePath: string) {
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

export async function deleteStoredFile(filePath: string, options?: { ignoreMissing?: boolean }) {
  const ignoreMissing = options?.ignoreMissing ?? false;

  if (!isCloudStoragePath(filePath)) {
    await fsp.rm(filePath, { force: ignoreMissing });
    return;
  }

  const { bucketName, objectName } = parseCloudStoragePath(filePath);
  await getStorageClient().bucket(bucketName).file(objectName).delete({
    ignoreNotFound: ignoreMissing,
  });
}

export async function getStoredFileMetadata(filePath: string): Promise<StoredFileMetadata> {
  if (!isCloudStoragePath(filePath)) {
    try {
      const stats = await fsp.stat(filePath);
      return {
        contentType: null,
        exists: true,
        sizeBytes: stats.size,
        updatedAt: stats.mtime.toISOString(),
      };
    } catch {
      return {
        contentType: null,
        exists: false,
        sizeBytes: null,
        updatedAt: null,
      };
    }
  }

  const { bucketName, objectName } = parseCloudStoragePath(filePath);
  const file = getStorageClient().bucket(bucketName).file(objectName);
  const [exists] = await file.exists();

  if (!exists) {
    return {
      contentType: null,
      exists: false,
      sizeBytes: null,
      updatedAt: null,
    };
  }

  const [metadata] = await file.getMetadata();
  return {
    contentType: metadata.contentType ?? null,
    exists: true,
    sizeBytes: metadata.size ? Number(metadata.size) : null,
    updatedAt: metadata.updated ?? null,
  };
}

export async function createCloudStorageResumableUploadSession(params: {
  bucketName: string;
  objectName: string;
  contentType: string;
  origin?: string | null;
  metadata?: Record<string, string>;
}) {
  const [uploadUrl] = await getStorageClient()
    .bucket(params.bucketName)
    .file(params.objectName)
    .createResumableUpload({
      metadata: {
        cacheControl: "no-store",
        contentType: params.contentType,
        metadata: params.metadata,
      },
      origin: params.origin ?? undefined,
    });

  return uploadUrl;
}
