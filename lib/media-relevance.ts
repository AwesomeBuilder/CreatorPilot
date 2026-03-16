import type { Idea, MediaRelevanceAssessment, Trend } from "@/lib/types";
import { buildStoryboardPlan, storyboardPlanToAssessment } from "@/lib/storyboard";

type MediaAssetInput = {
  id?: string;
  path: string;
  type: "image" | "video";
};

function fallbackTrendForIdea(idea: Idea): Trend {
  return {
    trendTitle: idea.videoTitle,
    summary: idea.hook,
    links: [],
  };
}

export async function assessMediaRelevance(params: {
  idea: Idea;
  assets: MediaAssetInput[];
  trend?: Trend;
}): Promise<MediaRelevanceAssessment> {
  const plan = await buildStoryboardPlan({
    trend: params.trend ?? fallbackTrendForIdea(params.idea),
    idea: params.idea,
    assets: params.assets.map((asset, index) => ({
      id: asset.id ?? `asset-${index + 1}`,
      path: asset.path,
      type: asset.type,
    })),
    preference: "auto",
  });

  return storyboardPlanToAssessment(plan);
}
