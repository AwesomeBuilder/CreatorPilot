import { promises as fs } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";

import { ensureDir } from "@/lib/ffmpeg";
import { llmGenerateImageDetailed, llmGenerateVideoDetailed } from "@/lib/llm";
import { generatedSupportEnabled, generatedSupportMediaMode } from "@/lib/media-flags";
import type { GeneratedVisualKind, GeneratedVisualProvider, RenderFormat } from "@/lib/types";

function imageSizeForFormat(format: RenderFormat) {
  return format === "shorts" ? "1024x1536" : "1536x1024";
}

function videoAspectRatioForFormat(format: RenderFormat) {
  return format === "shorts" ? "9:16" : "16:9";
}

function imageMimeTypeForPath(inputPath: string) {
  if (/\.jpe?g$/i.test(inputPath)) {
    return "image/jpeg";
  }

  return "image/png";
}

export type GeneratedSupportingAssetResult = {
  requestedKind: GeneratedVisualKind;
  resolvedKind?: GeneratedVisualKind;
  provider: GeneratedVisualProvider;
  path: string | null;
  previewPath?: string | null;
  fallbackAssetPath?: string | null;
  degradedFrom?: GeneratedVisualKind;
  error: string | null;
};

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

export async function createGeneratedSupportingVideoDetailed(params: {
  userId: string;
  scopeId: string;
  beatId: string;
  prompt: string;
  format: RenderFormat;
  initialImagePath: string;
  scope?: "render" | "storyboard-preview";
}) {
  if (!generatedSupportEnabled()) {
    return {
      path: null,
      error: "Generated supporting visuals are disabled by ENABLE_GENERATED_SUPPORT_MEDIA.",
    };
  }

  const sourceImage = await fs.readFile(params.initialImagePath);
  const generated = await llmGenerateVideoDetailed({
    prompt: params.prompt,
    aspectRatio: videoAspectRatioForFormat(params.format),
    durationSeconds: 4,
    resolution: "720p",
    negativePrompt: "static still frame, subtitles, watermarks, logos, distorted text, heavy artifacts, extra UI chrome",
    image: {
      mimeType: imageMimeTypeForPath(params.initialImagePath),
      base64: sourceImage.toString("base64"),
    },
  });

  if (!generated.base64) {
    return {
      path: null,
      error: generated.error ?? "The video model did not return a support clip.",
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
  const outputPath = path.join(outputDir, `${params.beatId}.mp4`);
  await fs.writeFile(outputPath, Buffer.from(generated.base64, "base64"));

  return {
    path: outputPath,
    error: null,
  };
}

export async function createGeneratedSupportingAssetDetailed(params: {
  userId: string;
  scopeId: string;
  beatId: string;
  prompt: string;
  format: RenderFormat;
  preferredKind?: GeneratedVisualKind;
  initialImagePath?: string | null;
  scope?: "render" | "storyboard-preview";
  allowStillFallback?: boolean;
}): Promise<GeneratedSupportingAssetResult> {
  const requestedKind = params.preferredKind ?? (generatedSupportMediaMode() === "video" ? "motion" : "still");
  const stillFallbackAllowed = params.allowStillFallback !== false;
  const existingInitialImage =
    params.initialImagePath && existsSync(params.initialImagePath) ? path.resolve(params.initialImagePath) : null;

  if (requestedKind === "motion") {
    let previewPath = existingInitialImage;

    if (!previewPath) {
      const imageResult = await createGeneratedSupportingImageDetailed({
        userId: params.userId,
        scopeId: params.scopeId,
        beatId: params.beatId,
        prompt: params.prompt,
        format: params.format,
        scope: params.scope,
      });

      if (!imageResult.path) {
        return {
          requestedKind,
          provider: "gemini-video",
          path: null,
          previewPath: null,
          error: imageResult.error ?? "The still preview required for motion generation was unavailable.",
        };
      }

      previewPath = imageResult.path;
    }

    const videoResult = await createGeneratedSupportingVideoDetailed({
      userId: params.userId,
      scopeId: params.scopeId,
      beatId: params.beatId,
      prompt: params.prompt,
      format: params.format,
      initialImagePath: previewPath,
      scope: params.scope,
    });

    if (videoResult.path) {
      return {
        requestedKind,
        resolvedKind: "motion",
        provider: "gemini-video",
        path: videoResult.path,
        previewPath,
        fallbackAssetPath: previewPath,
        error: null,
      };
    }

    if (stillFallbackAllowed && previewPath) {
      return {
        requestedKind,
        resolvedKind: "still",
        provider: "gemini-video",
        path: previewPath,
        previewPath,
        fallbackAssetPath: previewPath,
        degradedFrom: "motion",
        error: videoResult.error ?? "Motion generation failed, so the render fell back to a still.",
      };
    }

    return {
      requestedKind,
      provider: "gemini-video",
      path: null,
      previewPath,
      error: videoResult.error ?? "The motion model did not return a support clip.",
    };
  }

  if (existingInitialImage) {
    return {
      requestedKind,
      resolvedKind: "still",
      provider: "gemini-image",
      path: existingInitialImage,
      previewPath: existingInitialImage,
      error: null,
    };
  }

  const imageResult = await createGeneratedSupportingImageDetailed({
    userId: params.userId,
    scopeId: params.scopeId,
    beatId: params.beatId,
    prompt: params.prompt,
    format: params.format,
    scope: params.scope,
  });

  return {
    requestedKind,
    resolvedKind: imageResult.path ? "still" : undefined,
    provider: "gemini-image",
    path: imageResult.path,
    previewPath: imageResult.path,
    error: imageResult.error,
  };
}
