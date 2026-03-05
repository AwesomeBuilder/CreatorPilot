import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { resolveUser } from "@/lib/user";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "png", "jpg", "jpeg"]);

function extFromFilename(filename: string) {
  const split = filename.split(".");
  return split.length > 1 ? split.pop()?.toLowerCase() ?? "" : "";
}

function normalizeType(ext: string) {
  if (["mp4", "mov"].includes(ext)) {
    return "video";
  }

  return "image";
}

export async function GET(req: Request) {
  const user = await resolveUser(req);
  const assets = await prisma.mediaAsset.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ assets });
}

export async function POST(req: Request) {
  const user = await resolveUser(req);

  const formData = await req.formData();
  const requestedJobId = formData.get("jobId");
  const jobId = typeof requestedJobId === "string" && requestedJobId.trim().length > 0 ? requestedJobId : `manual-${Date.now()}`;

  const fileFields = formData.getAll("files");
  const files =
    fileFields.length > 0
      ? fileFields
      : [...formData.values()].filter((value) => value instanceof File && value.name !== "jobId");

  const uploaded = [] as Array<{ id: string; path: string; type: string }>;

  const targetDir = path.join(process.cwd(), "uploads", user.id, jobId);
  await fs.mkdir(targetDir, { recursive: true });

  for (const maybeFile of files) {
    if (!(maybeFile instanceof File)) {
      continue;
    }

    const ext = extFromFilename(maybeFile.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: `Unsupported file type: ${maybeFile.name}` }, { status: 400 });
    }

    const safeName = `${Date.now()}-${maybeFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const absolutePath = path.join(targetDir, safeName);

    const bytes = await maybeFile.arrayBuffer();
    await fs.writeFile(absolutePath, Buffer.from(bytes));

    const asset = await prisma.mediaAsset.create({
      data: {
        userId: user.id,
        path: absolutePath,
        type: normalizeType(ext),
      },
    });

    uploaded.push({
      id: asset.id,
      path: asset.path,
      type: asset.type,
    });
  }

  return NextResponse.json({
    jobId,
    uploaded,
  });
}
