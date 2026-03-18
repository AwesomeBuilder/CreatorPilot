import { prisma } from "@/lib/db";
import { getMediaUploadMode, reconcileMediaAssetsFromStorage, selectPreferredLocalUserRecoveredMediaAssets } from "@/lib/media-storage";

type ResolveRequestedMediaAssetsParams = {
  userId: string;
  mediaReferences: string[];
};

export async function resolveRequestedMediaAssets(params: ResolveRequestedMediaAssetsParams) {
  const requestedReferences = [...new Set(params.mediaReferences.map((reference) => reference.trim()).filter(Boolean))];

  if (requestedReferences.length === 0) {
    return [];
  }

  const findAssets = () =>
    prisma.mediaAsset.findMany({
      where: {
        userId: params.userId,
        status: "ready",
        OR: [
          {
            id: {
              in: requestedReferences,
            },
          },
          {
            path: {
              in: requestedReferences,
            },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

  let assets = await findAssets();
  assets = selectPreferredLocalUserRecoveredMediaAssets(params.userId, assets);

  if (assets.length === 0 && getMediaUploadMode() === "direct") {
    await reconcileMediaAssetsFromStorage(params.userId);
    assets = await findAssets();
    assets = selectPreferredLocalUserRecoveredMediaAssets(params.userId, assets);
  }

  return assets;
}
