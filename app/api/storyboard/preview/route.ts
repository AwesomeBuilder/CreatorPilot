import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

function isAllowedPreviewPath(userId: string, requestedPath: string) {
  const resolved = path.resolve(requestedPath);
  const uploadsRoot = path.resolve(process.cwd(), "uploads", userId);
  const allowedRoots = [path.join(uploadsRoot, "storyboard-preview"), path.join(uploadsRoot, "generated-support")].map((root) =>
    path.resolve(root),
  );

  return allowedRoots.some((root) => resolved.startsWith(root));
}

export async function GET(req: Request) {
  const user = await resolveUser(req);
  const requestedPath = new URL(req.url).searchParams.get("path");

  if (!requestedPath || !isAllowedPreviewPath(user.id, requestedPath)) {
    return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  }

  try {
    const bytes = await fs.readFile(path.resolve(requestedPath));
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "image/png",
      },
    });
  } catch {
    return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  }
}
