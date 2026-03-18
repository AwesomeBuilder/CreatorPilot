import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoryboardPlan } from "@/lib/types";

const { resolveStoredFileBinaryInputMock } = vi.hoisted(() => ({
  resolveStoredFileBinaryInputMock: vi.fn(async (filePath: string) => {
    if (filePath.startsWith("gs://")) {
      return {
        inputArgs: ["-headers", "Authorization: Bearer test-token\r\n"],
        inputPath: `https://storage.googleapis.com/download/storage/v1/b/test/o/${encodeURIComponent(filePath)}?alt=media`,
      };
    }

    return {
      inputPath: filePath,
    };
  }),
}));

vi.mock("@/lib/storage", () => ({
  resolveStoredFileBinaryInput: resolveStoredFileBinaryInputMock,
}));

import { renderTestUtils } from "@/lib/render";

describe("resolveStoryboardAssets", () => {
  afterEach(() => {
    resolveStoredFileBinaryInputMock.mockClear();
  });

  it("localizes supporting visuals for generated beats before render compositing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "creator-pilot-render-storage-"));

    try {
      const generatedMotionPath = path.join(tempDir, "generated-beat.mp4");
      await fs.writeFile(generatedMotionPath, "");

      const storyboard: StoryboardPlan = {
        format: "landscape",
        coverageScore: 64,
        coverageSummary: "Storyboard is ready for render.",
        shouldBlock: false,
        requiresMoreRelevantMedia: false,
        generatedSupportEnabled: true,
        generatedSupportUsed: true,
        assetSummaries: [],
        candidates: [],
        beats: [
          {
            beatId: "beat-3",
            order: 3,
            purpose: "proof",
            title: "Proof beat",
            caption: "Use the uploaded clip as supporting proof.",
            narration: "Use the uploaded clip as supporting proof.",
            durationSeconds: 3.2,
            visualIntent: "Pair generated framing with the uploaded demo clip.",
            coverageLevel: "usable",
            matchScore: 78,
            selectedCandidateId: null,
            selectedAssetId: null,
            selectedAssetPath: generatedMotionPath,
            mediaSource: "generated",
            assetType: "generated",
            matchReason: "Generated framing with creator footage as backup.",
            generatedVisualPrompt: "Create a branded proof sequence.",
            generatedVisualStatus: "generated",
            generatedAssetPlan: {
              requestedKind: "motion",
              resolvedKind: "motion",
              status: "generated",
              provider: "gemini-video",
              prompt: "Create a branded proof sequence.",
              assetPath: generatedMotionPath,
              previewPath: null,
              error: null,
            },
            supportingVisuals: [
              {
                visualId: "support-1",
                assetId: "media-1",
                assetPath: "gs://creatorpilot-489322-renders/media/user-1/media-1/demo.mov",
                assetType: "video",
                mediaSource: "user",
                label: "Uploaded clip @ 1:24",
                shotStartSeconds: 82.76,
                shotEndSeconds: 85.96,
                generatedVisualStatus: "not-needed",
                generatedPreviewPath: null,
              },
            ],
          },
        ],
      };

      const result = await renderTestUtils.resolveStoryboardAssets({
        userId: "local-user",
        jobId: "job-1",
        storyboard,
        tempDir,
      });

      const renderBeat = result.renderStoryboard.beats[0] as StoryboardPlan["beats"][number] & {
        selectedAssetInputArgs?: string[];
        supportingVisuals?: Array<{ assetPath: string | null; inputArgs?: string[] }>;
      };

      expect(renderBeat.selectedAssetPath).toBe(generatedMotionPath);
      expect(renderBeat.selectedAssetInputArgs).toBeUndefined();
      expect(renderBeat.supportingVisuals?.[0]?.assetPath).toMatch(
        /^https:\/\/storage\.googleapis\.com\/download\/storage\/v1\/b\/test\/o\//,
      );
      expect(renderBeat.supportingVisuals?.[0]?.inputArgs).toEqual(["-headers", "Authorization: Bearer test-token\r\n"]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
