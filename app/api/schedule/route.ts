import { NextResponse } from "next/server";
import { z } from "zod";

import { TIMEZONE_VALUES } from "@/lib/profile-options";
import { recommendPublishTime } from "@/lib/schedule";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const InputSchema = z.object({
  timezone: z.enum(TIMEZONE_VALUES).optional(),
});

export async function POST(req: Request) {
  const parsed = InputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await resolveUser(req);
  const timezone = parsed.data.timezone ?? user.timezone;

  const schedule = recommendPublishTime(timezone);
  return NextResponse.json({ schedule });
}
