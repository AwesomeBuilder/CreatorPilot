import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDir } from "@/lib/ffmpeg";
import { llmGenerateImageDetailed } from "@/lib/llm";
import { generatedSupportEnabled } from "@/lib/media-flags";
import type { RenderFormat } from "@/lib/types";

function imageSizeForFormat(format: RenderFormat) {
  return format === "shorts" ? "1024x1536" : "1536x1024";
}

export async function createGeneratedSupportingImage(params: {
  userId: string;
  scopeId: string;
  beatId: string;
  prompt: string;
  format: RenderFormat;
  scope?: "render" | "storyboard-preview";
}) {
  const result = await createGeneratedSupportingImageDetailed(params);
  return result.path;
}

export async function createGeneratedSupportingImageDetailed(params: {
  userId: string;
  scopeId: string;
  beatId: string;
  prompt: string;
  format: RenderFormat;
  scope?: "render" | "storyboard-preview";
}) {
  if (!generatedSupportEnabled()) {
    return {
      path: null,
      error: "Generated supporting visuals are disabled by ENABLE_GENERATED_SUPPORT_MEDIA.",
    };
  }

  const generated = await llmGenerateImageDetailed({
    prompt: params.prompt,
    size: imageSizeForFormat(params.format),
  });

  if (!generated.base64) {
    return {
      path: null,
      error: generated.error ?? "The image model did not return a preview image.",
    };
  }

  const outputDir = path.join(
    process.cwd(),
    "uploads",
    params.userId,
    params.scope === "storyboard-preview" ? "storyboard-preview" : "generated-support",
    params.scopeId,
  );
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${params.beatId}.png`);
  await fs.writeFile(outputPath, Buffer.from(generated.base64, "base64"));

  return {
    path: outputPath,
    error: null,
  };
}
