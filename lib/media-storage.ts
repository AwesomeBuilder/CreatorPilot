import { randomUUID } from "node:crypto";
import path from "node:path";

import { prisma } from "@/lib/db";
import { getStorageClient, isCloudStoragePath, parseCloudStoragePath } from "@/lib/storage";
import type { MediaAssetRecord, MediaAssetStatus, MediaAssetType, MediaUploadMode } from "@/lib/types";
import { LOCAL_USER_ID } from "@/lib/user";

export const ALLOWED_MEDIA_EXTENSIONS = new Set(["mp4", "mov", "png", "jpg", "jpeg"]);
const STALE_PENDING_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getMediaStorageBucket() {
  return process.env.MEDIA_STORAGE_BUCKET?.trim() || process.env.RENDER_STORAGE_BUCKET?.trim() || null;
}

export function getMediaUploadMode(): MediaUploadMode {
  return getMediaStorageBucket() ? "direct" : "server";
}

export function createMediaAssetId() {
  return `media_${randomUUID().replace(/-/g, "")}`;
}

export function extFromFilename(filename: string) {
  const split = filename.split(".");
  return split.length > 1 ? split.pop()?.toLowerCase() ?? "" : "";
}

export function sanitizeMediaFilename(filename: string) {
  const basename = path.basename(filename).trim();
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
}

export function normalizeMediaType(ext: string): MediaAssetType {
  return ["mp4", "mov"].includes(ext) ? "video" : "image";
}

export function inferMediaMimeType(filename: string, providedMimeType?: string | null) {
  const ext = extFromFilename(filename);
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";

  const trimmed = providedMimeType?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "application/octet-stream";
}

export function isSupportedMediaFilename(filename: string) {
  return ALLOWED_MEDIA_EXTENSIONS.has(extFromFilename(filename));
}

export function mediaObjectName(params: {
  userId: string;
  assetId: string;
  filename: string;
}) {
  return path.posix.join("media", params.userId, params.assetId, sanitizeMediaFilename(params.filename));
}

export function mediaStoragePath(params: {
  bucketName: string;
  userId: string;
  assetId: string;
  filename: string;
}) {
  return `gs://${params.bucketName}/${mediaObjectName(params)}`;
}

export function resolveMediaContentType(params: {
  filename?: string | null;
  mimeType?: string | null;
  path: string;
}) {
  const preferred = params.mimeType?.trim();
  if (preferred) {
    return preferred;
  }

  return inferMediaMimeType(params.filename?.trim() || path.basename(params.path));
}

export function mediaAssetDisplayName(asset: {
  filename?: string | null;
  path: string;
}) {
  const preferred = asset.filename?.trim();
  return preferred && preferred.length > 0 ? preferred : path.basename(asset.path);
}

function serializeSizeBytes(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }

  return typeof value === "number" ? value : null;
}

export function serializeMediaAsset(asset: {
  id: string;
  path: string;
  type: string;
  status?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: bigint | number | null;
}): MediaAssetRecord {
  const filename = asset.filename?.trim() || path.basename(asset.path);
  return {
    id: asset.id,
    path: asset.path,
    type: asset.type as MediaAssetType,
    status: (asset.status ?? "ready") as MediaAssetStatus,
    filename,
    mimeType: resolveMediaContentType({
      filename,
      mimeType: asset.mimeType,
      path: asset.path,
    }),
    sizeBytes: serializeSizeBytes(asset.sizeBytes),
  };
}

export async function markStalePendingMediaAssetsFailed(userId: string) {
  const cutoff = new Date(Date.now() - STALE_PENDING_MEDIA_MAX_AGE_MS);

  await prisma.mediaAsset.updateMany({
    where: {
      userId,
      status: "pending",
      updatedAt: {
        lt: cutoff,
      },
    },
    data: {
      status: "failed",
    },
  });
}

function parseRecoveredMediaObjectName(objectName: string) {
  const [scope, objectUserId, assetId, ...filenameParts] = objectName.split("/");
  const filename = filenameParts.join("/");

  if (scope !== "media" || !objectUserId || !assetId || !filename) {
    return null;
  }

  return {
    assetId,
    filename,
    userId: objectUserId,
  };
}

export function recoveredMediaOwnerIdFromPath(filePath: string) {
  if (!isCloudStoragePath(filePath)) {
    return null;
  }

  try {
    const { objectName } = parseCloudStoragePath(filePath);
    return parseRecoveredMediaObjectName(objectName)?.userId ?? null;
  } catch {
    return null;
  }
}

export function selectPreferredLocalUserRecoveredMediaAssets<
  TAsset extends {
    userId: string;
    path: string;
    createdAt: Date;
    updatedAt: Date;
  },
>(userId: string, assets: TAsset[]) {
  if (userId !== LOCAL_USER_ID || assets.length <= 1) {
    return assets;
  }

  const decoratedAssets = assets.map((asset) => ({
    asset,
    recoveredOwnerId: recoveredMediaOwnerIdFromPath(asset.path),
  }));

  if (decoratedAssets.some((entry) => !entry.recoveredOwnerId)) {
    return assets;
  }

  const groupedAssets = new Map<string, typeof decoratedAssets>();
  for (const entry of decoratedAssets) {
    const existing = groupedAssets.get(entry.recoveredOwnerId!) ?? [];
    existing.push(entry);
    groupedAssets.set(entry.recoveredOwnerId!, existing);
  }

  if (groupedAssets.size <= 1) {
    return assets;
  }

  if (groupedAssets.has(LOCAL_USER_ID)) {
    return decoratedAssets.filter((entry) => entry.recoveredOwnerId === LOCAL_USER_ID).map((entry) => entry.asset);
  }

  let preferredOwnerId: string | null = null;
  let preferredUpdatedAt = -Infinity;

  for (const [ownerId, ownerAssets] of groupedAssets) {
    const newestAssetTimestamp = Math.max(...ownerAssets.map((entry) => entry.asset.updatedAt.getTime()));
    if (newestAssetTimestamp > preferredUpdatedAt) {
      preferredOwnerId = ownerId;
      preferredUpdatedAt = newestAssetTimestamp;
    }
  }

  return preferredOwnerId
    ? decoratedAssets.filter((entry) => entry.recoveredOwnerId === preferredOwnerId).map((entry) => entry.asset)
    : assets;
}

function normalizeRecoveredMediaType(filename: string, contentType?: string | null): MediaAssetType {
  if (contentType?.startsWith("video/")) {
    return "video";
  }

  return normalizeMediaType(extFromFilename(filename));
}

function safeMetadataDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function listRecoverableMediaFiles(params: {
  bucketName: string;
  userId: string;
}) {
  const bucket = getStorageClient().bucket(params.bucketName);

  const listFiles = async (prefix: string) => {
    const [files] = await bucket.getFiles({ prefix });
    return files.filter((file) => !file.name.endsWith("/"));
  };

  const userScopedFiles = await listFiles(`${path.posix.join("media", params.userId)}/`);
  if (userScopedFiles.length > 0 || params.userId !== LOCAL_USER_ID) {
    return userScopedFiles;
  }

  return listFiles("media/");
}

function selectPreferredLocalUserRecoveredFiles<
  TFile extends {
    createdAt: Date;
    updatedAt: Date;
    parsed: {
      userId: string;
    };
  },
>(userId: string, files: TFile[]) {
  if (userId !== LOCAL_USER_ID || files.length <= 1) {
    return files;
  }

  const groupedFiles = new Map<string, TFile[]>();
  for (const file of files) {
    const existing = groupedFiles.get(file.parsed.userId) ?? [];
    existing.push(file);
    groupedFiles.set(file.parsed.userId, existing);
  }

  if (groupedFiles.size <= 1) {
    return files;
  }

  let preferredOwnerId: string | null = null;
  let preferredUpdatedAt = -Infinity;

  for (const [ownerId, ownerFiles] of groupedFiles) {
    const newestFileTimestamp = Math.max(...ownerFiles.map((file) => file.updatedAt.getTime()));
    if (newestFileTimestamp > preferredUpdatedAt) {
      preferredOwnerId = ownerId;
      preferredUpdatedAt = newestFileTimestamp;
    }
  }

  return preferredOwnerId ? files.filter((file) => file.parsed.userId === preferredOwnerId) : files;
}

type RecoveredMediaFile = {
  createdAt: Date;
  mimeType: string;
  parsed: {
    assetId: string;
    filename: string;
    userId: string;
  };
  path: string;
  sizeBytes: bigint | null;
  type: MediaAssetType;
  updatedAt: Date;
};

export async function reconcileMediaAssetsFromStorage(userId: string) {
  const bucketName = getMediaStorageBucket();
  if (!bucketName) {
    return 0;
  }

  const objectFiles = await listRecoverableMediaFiles({
    bucketName,
    userId,
  });

  if (objectFiles.length === 0) {
    return 0;
  }

  const recoveredFiles = (
    await Promise.all(
      objectFiles.map(async (file) => {
        const parsed = parseRecoveredMediaObjectName(file.name);
        if (!parsed) {
          return null;
        }

        const [metadata] = await file.getMetadata();
        const mimeType = inferMediaMimeType(parsed.filename, metadata.contentType ?? null);
        const updatedAt = safeMetadataDate(metadata.updated) ?? new Date();
        const createdAt = safeMetadataDate(metadata.timeCreated) ?? updatedAt;

        return {
          createdAt,
          mimeType,
          parsed,
          path: `gs://${bucketName}/${file.name}`,
          sizeBytes: metadata.size ? BigInt(metadata.size) : null,
          type: normalizeRecoveredMediaType(parsed.filename, metadata.contentType ?? null),
          updatedAt,
        };
      }),
    )
  ).filter((file): file is RecoveredMediaFile => file !== null);

  const filesToPersist = selectPreferredLocalUserRecoveredFiles(userId, recoveredFiles);

  await Promise.all(
    filesToPersist.map(async (file) => {
      const { createdAt, mimeType, parsed, path: filePath, sizeBytes, type, updatedAt } = file;

      await prisma.mediaAsset.upsert({
        where: {
          id: parsed.assetId,
        },
        create: {
          id: parsed.assetId,
          userId,
          path: filePath,
          type,
          status: "ready",
          filename: parsed.filename,
          mimeType,
          sizeBytes,
          createdAt,
          updatedAt,
        },
        update: {
          path: filePath,
          type,
          status: "ready",
          filename: parsed.filename,
          mimeType,
          sizeBytes,
          updatedAt,
        },
      });
    }),
  );

  return filesToPersist.length;
}

export function requestOrigin(req: Request) {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (appBaseUrl) {
    try {
      return new URL(appBaseUrl).origin;
    } catch {
      // Fall through to the request origin.
    }
  }

  const headerOrigin = req.headers.get("origin");
  if (headerOrigin) {
    return headerOrigin;
  }

  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}
