import { NextResponse } from "next/server";

import { resolveUser } from "@/lib/user";
import { completeYoutubeOAuth } from "@/lib/youtube";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard?youtube=oauth_error", appBaseUrl));
  }

  try {
    const fallbackUser = await resolveUser(req);
    await completeYoutubeOAuth({
      code,
      state,
      fallbackUserId: fallbackUser.id,
    });

    return NextResponse.redirect(new URL("/dashboard?youtube=connected", appBaseUrl));
  } catch {
    return NextResponse.redirect(new URL("/dashboard?youtube=oauth_error", appBaseUrl));
  }
}
