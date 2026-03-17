import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import { createJob, runJobInBackground } from "@/lib/jobs";
import { withLocalRenderPath } from "@/lib/render-storage";
import { resolveUser } from "@/lib/user";
import { getYoutubeAuthUrl, getYoutubeConnectionStatus, uploadVideoToYoutube } from "@/lib/youtube";

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

  let resolvedPath = parsed.data.renderPath;

  if (!resolvedPath && parsed.data.renderId) {
    const render = await prisma.render.findFirst({
      where: {
        id: parsed.data.renderId,
        userId: user.id,
      },
    });

    resolvedPath = render?.path;
  }

  if (!resolvedPath) {
    return NextResponse.json({ error: "No render file was provided." }, { status: 400 });
  }

  const renderProbe = await withLocalRenderPath(resolvedPath, async (localPath) => probeMedia(localPath));
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
    await log("Uploading rendered video to YouTube.");

    const result = await withLocalRenderPath(resolvedPath, async (localPath) =>
      uploadVideoToYoutube({
        userId: user.id,
        videoPath: localPath,
        title: parsed.data.title,
        description: parsed.data.description,
        tags: parsed.data.tags,
        publishAt: parsed.data.publishAt,
      }),
    );

    await log(`Upload finished in ${result.mode} mode.`);
    return result;
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
