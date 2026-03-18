import path from "node:path";

import { createStoredFileResponse, getStorageClient, storedFileExists, withLocalStoredFilePath } from "@/lib/storage";

const RENDER_STORAGE_BUCKET = process.env.RENDER_STORAGE_BUCKET?.trim() || null;

export function getRenderStorageBucket() {
  return RENDER_STORAGE_BUCKET;
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

export async function createStoredRenderResponse(params: {
  req: Request;
  filePath: string;
  contentType: string;
  includeBody?: boolean;
}) {
  return createStoredFileResponse(params);
}

export async function withLocalRenderPath<T>(filePath: string, fn: (localPath: string) => Promise<T>) {
  return withLocalStoredFilePath(filePath, fn);
}

export async function renderFileExists(filePath: string) {
  return storedFileExists(filePath);
}
