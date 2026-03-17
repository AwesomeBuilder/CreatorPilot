import { prisma } from "@/lib/db";
import { areSameSourceSets, findMatchingCuratedPreset, getCuratedSourcesForNiche } from "@/lib/default-sources";
import { probeMedia } from "@/lib/ffmpeg";
import { generateIdeas } from "@/lib/ideas";
import { generateMetadata } from "@/lib/metadata";
import { resolveRequestedMediaAssets } from "@/lib/media-assets";
import { renderVideoVariants } from "@/lib/render";
import { persistRenderVariants, withLocalRenderPath } from "@/lib/render-storage";
import { fetchRssEntries } from "@/lib/rss";
import { recommendPublishTime } from "@/lib/schedule";
import { buildStoryboardPlan, hydrateStoryboardGeneratedPreviews, storyboardPlanToAssessment } from "@/lib/storyboard";
import { clusterEntriesIntoTrends } from "@/lib/trends";
import { uploadVideoToYoutube } from "@/lib/youtube";
import type { RenderOutput, StoryboardPlan } from "@/lib/types";
import type {
  AgentUserContext,
  CreatorMemorySnapshot,
  PublishingInput,
  PublishingResult,
  ResolvedAgentMediaAsset,
} from "@/lib/agents/base-agent";

type EnabledSource = {
  id: string;
  url: string;
  enabled: boolean;
  isCurated: boolean;
};

function parseJsonObject(input?: string | null) {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function inferSourceMode(sources: EnabledSource[]): CreatorMemorySnapshot["preferences"]["sourceMode"] {
  if (sources.length === 0) {
    return "none";
  }

  const curatedCount = sources.filter((source) => source.isCurated).length;
  if (curatedCount === 0) {
    return "custom";
  }

  if (curatedCount === sources.length) {
    return "curated";
  }

  return "mixed";
}

function summarizeMemory(params: {
  user: AgentUserContext;
  sources: EnabledSource[];
  recentRenders: Array<{ createdAt: Date; outputJson: string | null }>;
  recentPublishes: Array<{ createdAt: Date; outputJson: string | null }>;
}) {
  const enabledSources = params.sources.length;
  const sourceMode = inferSourceMode(params.sources);
  const latestRender = params.recentRenders
    .map((job) => parseJsonObject(job.outputJson))
    .find((output) => typeof (output as { format?: unknown } | null)?.format === "string") as { format?: string } | null;
  const latestPublish = params.recentPublishes
    .map((job) => parseJsonObject(job.outputJson))
    .find((output) => output !== null) as { mode?: string; url?: string | null } | null;

  const profileBits = [
    params.user.niche ? `niche ${params.user.niche}` : "no explicit niche selected",
    params.user.tone ? `tone ${params.user.tone}` : "no saved tone preference",
    `timezone ${params.user.timezone}`,
  ];

  const outputBits = [
    `${enabledSources} enabled source${enabledSources === 1 ? "" : "s"} (${sourceMode})`,
    latestRender?.format ? `latest render format ${latestRender.format}` : "no recent render format saved",
    latestPublish?.mode ? `latest publishing mode ${latestPublish.mode}` : "no recent publishing result saved",
  ];

  return `Creator profile: ${profileBits.join(", ")}. Recent operating context: ${outputBits.join(", ")}.`;
}

async function loadCreatorMemorySnapshot(user: AgentUserContext): Promise<CreatorMemorySnapshot> {
  const [sources, recentRenderJobs, recentPublishJobs] = await Promise.all([
    prisma.source.findMany({
      where: {
        userId: user.id,
        enabled: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.job.findMany({
      where: {
        userId: user.id,
        type: "render",
        status: "complete",
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        type: true,
        createdAt: true,
        outputJson: true,
      },
    }),
    prisma.job.findMany({
      where: {
        userId: user.id,
        type: "youtube-upload",
        status: "complete",
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        type: true,
        createdAt: true,
        outputJson: true,
      },
    }),
  ]);

  const recentRenderFormat =
    recentRenderJobs
      .map((job) => parseJsonObject(job.outputJson) as { format?: "shorts" | "landscape" } | null)
      .find((output) => output?.format)?.format ?? null;

  const pastOutputs = [
    ...recentRenderJobs.map((job) => {
      const output = parseJsonObject(job.outputJson) as { format?: "shorts" | "landscape"; variants?: unknown[] } | null;
      return {
        jobId: job.id,
        type: job.type,
        createdAt: job.createdAt.toISOString(),
        format: output?.format ?? null,
        renderCount: Array.isArray(output?.variants) ? output.variants.length : undefined,
      };
    }),
    ...recentPublishJobs.map((job) => {
      const output = parseJsonObject(job.outputJson) as { url?: string | null } | null;
      return {
        jobId: job.id,
        type: job.type,
        createdAt: job.createdAt.toISOString(),
        publishedUrl: output?.url ?? null,
      };
    }),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    profile: user,
    preferences: {
      enabledSources: sources.map((source) => source.url),
      sourceMode: inferSourceMode(sources),
      recentRenderFormat,
    },
    pastOutputs,
    summary: summarizeMemory({
      user,
      sources,
      recentRenders: recentRenderJobs,
      recentPublishes: recentPublishJobs,
    }),
  };
}

async function ensureEnabledSources(params: { user: AgentUserContext }) {
  let enabledSources = await prisma.source.findMany({
    where: {
      userId: params.user.id,
      enabled: true,
    },
  });

  if (enabledSources.length === 0) {
    const curated = getCuratedSourcesForNiche(params.user.niche);
    await prisma.source.createMany({
      data: curated.map((url) => ({
        userId: params.user.id,
        url,
        enabled: true,
        isCurated: true,
      })),
    });

    enabledSources = await prisma.source.findMany({
      where: {
        userId: params.user.id,
        enabled: true,
      },
    });
  }

  const targetCurated = getCuratedSourcesForNiche(params.user.niche);
  const presetMatch = findMatchingCuratedPreset(enabledSources.map((source) => source.url));
  let sourceSyncNote: string | null = null;

  if (presetMatch && !areSameSourceSets(enabledSources.map((source) => source.url), targetCurated)) {
    await prisma.$transaction([
      prisma.source.deleteMany({ where: { userId: params.user.id } }),
      prisma.source.createMany({
        data: targetCurated.map((url) => ({
          userId: params.user.id,
          url,
          enabled: true,
          isCurated: true,
        })),
      }),
    ]);

    enabledSources = await prisma.source.findMany({
      where: {
        userId: params.user.id,
        enabled: true,
      },
    });

    sourceSyncNote = `Curated feeds were refreshed to match ${params.user.niche ?? "General / Mixed"}.`;
  }

  return {
    sources: enabledSources,
    sourceSyncNote,
  };
}

async function resolveMediaAssets(params: {
  userId: string;
  mediaReferences: string[];
}): Promise<ResolvedAgentMediaAsset[]> {
  const assets = await resolveRequestedMediaAssets(params);

  return assets.map((asset) => ({
    id: asset.id,
    path: asset.path,
    type: asset.type as "image" | "video",
  }));
}

async function saveRenderVariants(params: {
  userId: string;
  jobId: string;
  variants: RenderOutput["variants"];
}) {
  const persistedVariants = await persistRenderVariants(params);

  await prisma.$transaction(
    persistedVariants.map((variant) =>
      prisma.render.create({
        data: {
          userId: params.userId,
          jobId: params.jobId,
          variantIndex: variant.variantIndex,
          path: variant.path,
          duration: variant.duration,
        },
      }),
    ),
  );

  return persistedVariants;
}

async function resolveRenderPath(params: {
  userId: string;
  input: PublishingInput;
}) {
  if (params.input.renderPath) {
    return params.input.renderPath;
  }

  if (!params.input.renderId) {
    return null;
  }

  const render = await prisma.render.findFirst({
    where: {
      id: params.input.renderId,
      userId: params.userId,
    },
  });

  return render?.path ?? null;
}

async function probeStoredRender(filePath: string) {
  return withLocalRenderPath(filePath, async (localPath) => probeMedia(localPath));
}

async function uploadStoredRender(params: {
  userId: string;
  filePath: string;
  title: string;
  description: string;
  tags?: string[];
  publishAt?: string;
}): Promise<PublishingResult> {
  return withLocalRenderPath(params.filePath, async (localPath) =>
    uploadVideoToYoutube({
      userId: params.userId,
      videoPath: localPath,
      title: params.title,
      description: params.description,
      tags: params.tags,
      publishAt: params.publishAt,
    }),
  );
}

export type AgentTools = {
  loadCreatorMemorySnapshot: typeof loadCreatorMemorySnapshot;
  ensureEnabledSources: typeof ensureEnabledSources;
  fetchTrendEntries: typeof fetchRssEntries;
  clusterTrendEntries: typeof clusterEntriesIntoTrends;
  resolveMediaAssets: typeof resolveMediaAssets;
  generateIdeas: typeof generateIdeas;
  buildStoryboard: typeof buildStoryboardPlan;
  hydrateStoryboardGeneratedPreviews: typeof hydrateStoryboardGeneratedPreviews;
  storyboardToAssessment: typeof storyboardPlanToAssessment;
  renderVideoVariants: typeof renderVideoVariants;
  saveRenderVariants: typeof saveRenderVariants;
  generateMetadata: typeof generateMetadata;
  recommendPublishTime: typeof recommendPublishTime;
  resolveRenderPath: typeof resolveRenderPath;
  probeStoredRender: typeof probeStoredRender;
  uploadStoredRender: typeof uploadStoredRender;
};

export function createAgentTools(): AgentTools {
  return {
    loadCreatorMemorySnapshot,
    ensureEnabledSources,
    fetchTrendEntries: fetchRssEntries,
    clusterTrendEntries: clusterEntriesIntoTrends,
    resolveMediaAssets,
    generateIdeas,
    buildStoryboard: buildStoryboardPlan,
    hydrateStoryboardGeneratedPreviews,
    storyboardToAssessment: storyboardPlanToAssessment,
    renderVideoVariants,
    saveRenderVariants,
    generateMetadata,
    recommendPublishTime,
    resolveRenderPath,
    probeStoredRender,
    uploadStoredRender,
  };
}

export async function buildStoryboardWithPreviews(params: {
  userId: string;
  trend: NonNullable<Parameters<typeof buildStoryboardPlan>[0]["trend"]>;
  idea: Parameters<typeof buildStoryboardPlan>[0]["idea"];
  assets: Parameters<typeof buildStoryboardPlan>[0]["assets"];
  preference: Parameters<typeof buildStoryboardPlan>[0]["preference"];
  providedStoryboard?: StoryboardPlan;
}) {
  const storyboard =
    params.providedStoryboard ??
    (await buildStoryboardPlan({
      trend: params.trend,
      idea: params.idea,
      assets: params.assets,
      preference: params.preference,
    }));

  if (params.providedStoryboard) {
    return storyboard;
  }

  return hydrateStoryboardGeneratedPreviews({
    userId: params.userId,
    scopeId: `storyboard-${Date.now()}`,
    storyboard,
  });
}
