import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FFMPEG_BIN, probeMedia, runBinary } from "@/lib/ffmpeg";

const testRoot = path.join(process.cwd(), "tmp", "ffmpeg-test");
const samplePath = path.join(testRoot, "sample-with-audio.mp4");

describe("probeMedia", () => {
  beforeEach(async () => {
    await fs.mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("detects audio streams in rendered mp4 files", async () => {
    await runBinary(FFMPEG_BIN, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=1",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      samplePath,
    ]);

    const result = await probeMedia(samplePath);

    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.duration).toBeGreaterThan(0.9);
    expect(result.hasAudio).toBe(true);
  });
});
