import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { llmChatJSONWithUserContent } from "@/lib/llm";
import type { Idea, MediaRelevanceAssessment } from "@/lib/types";

type MediaAssetInput = {
  path: string;
  type: string;
};

const AssessmentSchema = z.object({
  status: z.enum(["relevant", "unclear", "irrelevant"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(240),
  matchedSignals: z.array(z.string()).max(5).default([]),
  shouldBlock: z.boolean(),
});

const STOPWORDS = new Set([
  "about",
  "after",
  "against",
  "because",
  "before",
  "being",
  "below",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "just",
  "more",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "what",
  "with",
  "your",
]);

function normalizeToken(token: string) {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractKeywords(text: string) {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function inferMimeType(assetPath: string) {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return null;
}

async function buildImageContent(assetPath: string) {
  const mimeType = inferMimeType(assetPath);
  if (!mimeType) {
    return null;
  }

  const stat = await fs.stat(assetPath);
  if (stat.size > 1_500_000) {
    return null;
  }

  const bytes = await fs.readFile(assetPath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function fallbackAssessment(idea: Idea, assets: MediaAssetInput[]): MediaRelevanceAssessment {
  const assetNames = assets.map((asset) => path.basename(asset.path));
  const ideaKeywords = new Set(extractKeywords(`${idea.videoTitle} ${idea.hook} ${idea.bulletOutline.join(" ")}`));
  const matchedSignals = assetNames.filter((name) =>
    extractKeywords(name).some((token) => ideaKeywords.has(token)),
  );

  if (matchedSignals.length > 0) {
    return {
      status: "relevant",
      confidence: 0.7,
      summary: "Uploaded media filenames overlap with the selected idea, so the render can proceed.",
      matchedSignals,
      shouldBlock: false,
    };
  }

  return {
    status: "unclear",
    confidence: 0.45,
    summary: "The uploaded media does not obviously match the selected idea. Topic-specific screenshots or product visuals will produce a better render.",
    matchedSignals: assetNames.slice(0, 3),
    shouldBlock: false,
  };
}

export async function assessMediaRelevance(params: {
  idea: Idea;
  assets: MediaAssetInput[];
}): Promise<MediaRelevanceAssessment> {
  if (params.assets.length === 0) {
    return {
      status: "irrelevant",
      confidence: 1,
      summary: "No uploaded media is available. Upload visuals that match the selected idea before rendering.",
      matchedSignals: [],
      shouldBlock: true,
    };
  }

  const imageAssets = params.assets.filter((asset) => asset.type === "image").slice(0, 2);

  if (imageAssets.length > 0) {
    try {
      const imageContent = (
        await Promise.all(
          imageAssets.map(async (asset) => {
            const dataUrl = await buildImageContent(asset.path);
            return dataUrl
              ? [
                  { type: "text", text: `Image filename: ${path.basename(asset.path)}` },
                  { type: "image_url", image_url: { url: dataUrl } },
                ]
              : [];
          }),
        )
      ).flat();

      if (imageContent.length > 0) {
        const response = await llmChatJSONWithUserContent<MediaRelevanceAssessment>({
          system:
            "You audit whether uploaded visuals match a short-form video idea. Block only when the visual topic is clearly unrelated or would make the final video misleading.",
          userContent: [
            {
              type: "text",
              text: JSON.stringify({
                task: "Assess whether the uploaded media is relevant to the selected video idea.",
                idea: params.idea,
                outputSchema: {
                  status: "relevant | unclear | irrelevant",
                  confidence: "number 0..1",
                  summary: "short string",
                  matchedSignals: ["string"],
                  shouldBlock: "boolean",
                },
              }),
            },
            ...imageContent,
          ],
          temperature: 0.2,
        });

        const parsed = AssessmentSchema.safeParse(response);
        if (parsed.success) {
          return parsed.data;
        }
      }
    } catch {
      // Fall through to the heuristic path if the multimodal request fails.
    }
  }

  return fallbackAssessment(params.idea, params.assets);
}
