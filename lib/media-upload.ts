import type { MediaUploadMode } from "@/lib/types";

export const CLOUD_RUN_MULTIPART_HARD_LIMIT_BYTES = 32 * 1024 * 1024;
export const CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES = 30 * 1024 * 1024;

type MediaFileLike = {
  name: string;
  size: number;
};

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function isCloudRunHostname(hostname?: string | null) {
  return Boolean(hostname && hostname.endsWith(".run.app"));
}

export function formatLegacyUploadTooLargeMessage() {
  return `Upload is too large for this Cloud Run deployment. Keep each file at or below ${formatFileSize(CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES)}.`;
}

export function validateClientMediaUpload(params: {
  files: Iterable<MediaFileLike>;
  hostname?: string | null;
  uploadMode?: MediaUploadMode;
}) {
  if (params.uploadMode === "direct") {
    return null;
  }

  if (!isCloudRunHostname(params.hostname)) {
    return null;
  }

  const oversizedFile = Array.from(params.files).find((file) => file.size > CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES);
  if (!oversizedFile) {
    return null;
  }

  return `${oversizedFile.name} is ${formatFileSize(oversizedFile.size)}. This Cloud Run deployment rejects direct uploads near ${formatFileSize(
    CLOUD_RUN_MULTIPART_HARD_LIMIT_BYTES,
  )}, so keep each file at or below ${formatFileSize(CLOUD_RUN_MULTIPART_SAFE_LIMIT_BYTES)}.`;
}
