import { NextResponse } from "next/server";
import { z } from "zod";

import { createCreatorPilotOrchestrator } from "@/lib/agents/orchestrator";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const InputSchema = z.object({
  trend: z.object({
    trendTitle: z.string(),
    summary: z.string(),
    links: z.array(z.string()).default([]),
  }),
  idea: z.object({
    videoTitle: z.string(),
    hook: z.string(),
    bulletOutline: z.array(z.string()),
    cta: z.string(),
  }),
});

export async function POST(req: Request) {
  const parsed = InputSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);
  const orchestrator = createCreatorPilotOrchestrator();
  const state = await orchestrator.runMetadataWorkflow({
    user,
    input: {
      trend: parsed.data.trend,
      idea: parsed.data.idea,
    },
  });

  return NextResponse.json({ metadata: state.metadata });
}
