import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getCuratedSourcesForNiche } from "@/lib/default-sources";
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

    const enabledSources = await prisma.source.findMany({
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
    }

    const refreshedSources = await prisma.source.findMany({
      where: {
        userId: user.id,
        enabled: true,
      },
    });

    await log(`Fetching RSS entries from ${refreshedSources.length} sources.`);
    const entries = await fetchRssEntries(refreshedSources.map((source) => source.url));

    if (entries.length === 0) {
      await log("No entries found from RSS feeds.");
      return { trends: [] };
    }

    await log(`Fetched ${entries.length} entries. Clustering into trends.`);
    const trends = await clusterEntriesIntoTrends(entries, 3);

    await log(`Generated ${trends.length} trends.`);
    return {
      trends,
      sourceCount: refreshedSources.length,
      entryCount: entries.length,
    };
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
