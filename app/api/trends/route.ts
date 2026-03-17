import { NextResponse } from "next/server";

import { createCreatorPilotOrchestrator } from "@/lib/agents/orchestrator";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await resolveUser(req);
  const orchestrator = createCreatorPilotOrchestrator();

  const job = await createJob({
    userId: user.id,
    type: "trends",
    logs: ["Queued trend detection job."],
  });

  runJobInBackground(job.id, async ({ log }) => {
    const state = await orchestrator.runTrendDiscoveryWorkflow({
      user,
      jobId: job.id,
      log,
      maxTrends: 5,
    });

    return {
      trends: state.trends ?? [],
      sourceCount: state.trendDiscovery?.sourceCount ?? 0,
      entryCount: state.trendDiscovery?.entryCount ?? 0,
      sourceSyncNote: state.trendDiscovery?.sourceSyncNote ?? null,
    };
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
