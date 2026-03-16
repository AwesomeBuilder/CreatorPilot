import { prisma } from "@/lib/db";

type ResolveRequestedMediaAssetsParams = {
  userId: string;
  mediaReferences: string[];
};

export async function resolveRequestedMediaAssets(params: ResolveRequestedMediaAssetsParams) {
  const requestedReferences = [...new Set(params.mediaReferences.map((reference) => reference.trim()).filter(Boolean))];

  if (requestedReferences.length === 0) {
    return [];
  }

  return prisma.mediaAsset.findMany({
    where: {
      userId: params.userId,
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
}
