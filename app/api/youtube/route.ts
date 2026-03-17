import { NextResponse } from "next/server";
import { z } from "zod";

import { createCreatorPilotOrchestrator } from "@/lib/agents/orchestrator";
import { createAgentTools } from "@/lib/agents/tools";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { resolveUser } from "@/lib/user";
import { getYoutubeAuthUrl, getYoutubeConnectionStatus } from "@/lib/youtube";

export const runtime = "nodejs";

const UploadSchema = z.object({
  renderId: z.string().optional(),
  renderPath: z.string().optional(),
  title: z.string().min(1).max(100),
  description: z.string().min(1),
  tags: z.array(z.string()).optional(),
  publishAt: z.string().datetime().optional(),
});

export async function GET(req: Request) {
  const user = await resolveUser(req);
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "auth-url") {
    const authUrl = await getYoutubeAuthUrl(user.id);
    const status = await getYoutubeConnectionStatus(user.id);

    return NextResponse.json({
      status,
      authUrl,
      canConnect: Boolean(authUrl),
    });
  }

  const status = await getYoutubeConnectionStatus(user.id);
  return NextResponse.json({ status });
}

export async function POST(req: Request) {
  const parsed = UploadSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);
  const tools = createAgentTools();
  const orchestrator = createCreatorPilotOrchestrator({ tools });

  const resolvedPath = await tools.resolveRenderPath({
    userId: user.id,
    input: parsed.data,
  });

  if (!resolvedPath) {
    return NextResponse.json({ error: "No render file was provided." }, { status: 400 });
  }

  const renderProbe = await tools.probeStoredRender(resolvedPath);
  if (!renderProbe.hasAudio) {
    return NextResponse.json(
      { error: "This render has no audio track. Generate narration/audio before uploading to YouTube." },
      { status: 400 },
    );
  }

  const job = await createJob({
    userId: user.id,
    type: "youtube-upload",
    logs: ["Queued YouTube upload job."],
  });

  runJobInBackground(job.id, async ({ log }) => {
    const state = await orchestrator.runPublishingWorkflow({
      user,
      jobId: job.id,
      log,
      input: {
        renderPath: resolvedPath,
        title: parsed.data.title,
        description: parsed.data.description,
        tags: parsed.data.tags,
        publishAt: parsed.data.publishAt,
      },
    });

    if (!state.publishResult) {
      throw new Error("Publishing workflow completed without a result.");
    }

    return state.publishResult;
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
