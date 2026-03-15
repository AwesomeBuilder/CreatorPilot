import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { areSameSourceSets, findMatchingCuratedPreset, getCuratedSourcesForNiche } from "@/lib/default-sources";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { fetchRssEntries } from "@/lib/rss";
import { clusterEntriesIntoTrends } from "@/lib/trends";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await resolveUser(req);

  const job = await createJob({
    userId: user.id,
    type: "trends",
    logs: ["Queued trend detection job."],
  });

  runJobInBackground(job.id, async ({ log }) => {
    await log("Loading enabled RSS sources.");

    let enabledSources = await prisma.source.findMany({
      where: {
        userId: user.id,
        enabled: true,
      },
    });

    if (enabledSources.length === 0) {
      await log("No user sources found. Seeding curated defaults.");
      const curated = getCuratedSourcesForNiche(user.niche);
      await prisma.source.createMany({
        data: curated.map((url) => ({
          userId: user.id,
          url,
          enabled: true,
          isCurated: true,
        })),
      });
      enabledSources = await prisma.source.findMany({
        where: {
          userId: user.id,
          enabled: true,
        },
      });
    }

    const targetCurated = getCuratedSourcesForNiche(user.niche);
    const presetMatch = findMatchingCuratedPreset(enabledSources.map((source) => source.url));
    let sourceSyncNote: string | null = null;

    if (presetMatch && !areSameSourceSets(enabledSources.map((source) => source.url), targetCurated)) {
      await log(`Detected stale curated feeds from ${presetMatch}. Syncing to ${user.niche ?? "General / Mixed"}.`);
      await prisma.$transaction([
        prisma.source.deleteMany({ where: { userId: user.id } }),
        prisma.source.createMany({
          data: targetCurated.map((url) => ({
            userId: user.id,
            url,
            enabled: true,
            isCurated: true,
          })),
        }),
      ]);

      enabledSources = await prisma.source.findMany({
        where: {
          userId: user.id,
          enabled: true,
        },
      });

      sourceSyncNote = `Curated feeds were refreshed to match ${user.niche ?? "General / Mixed"}.`;
    }

    await log(`Fetching RSS entries from ${enabledSources.length} sources.`);
    const entries = await fetchRssEntries(enabledSources.map((source) => source.url));

    if (entries.length === 0) {
      await log("No entries found from RSS feeds.");
      return { trends: [] };
    }

    await log(`Fetched ${entries.length} entries. Clustering into trends.`);
    const trends = await clusterEntriesIntoTrends(entries, 5, user.niche);

    await log(`Generated ${trends.length} trends.`);
    return {
      trends,
      sourceCount: enabledSources.length,
      entryCount: entries.length,
      sourceSyncNote,
    };
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
