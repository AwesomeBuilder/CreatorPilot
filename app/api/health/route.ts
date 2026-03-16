import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: process.env.K_SERVICE ?? null,
    revision: process.env.K_REVISION ?? null,
    configuration: process.env.K_CONFIGURATION ?? null,
    deployment: process.env.K_SERVICE ? "cloud-run" : "local",
    timestamp: new Date().toISOString(),
  });
}
