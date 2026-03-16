import { describe, expect, it } from "vitest";

import { renderTestUtils } from "@/lib/render";

describe("render helpers", () => {
  it("respects explicit render preferences", () => {
    expect(renderTestUtils.pickFormat("shorts", { width: 1920, height: 1080, duration: 300 })).toEqual({
      format: "shorts",
      reason: "User preference set to Shorts (1080x1920).",
    });

    expect(renderTestUtils.pickFormat("landscape", { width: 1080, height: 1920, duration: 20 })).toEqual({
      format: "landscape",
      reason: "User preference set to landscape (1920x1080).",
    });
  });

  it("auto-selects shorts for portrait or short source media and landscape otherwise", () => {
    expect(renderTestUtils.pickFormat("auto", { width: 1080, height: 1920, duration: 300 }).format).toBe("shorts");
    expect(renderTestUtils.pickFormat("auto", { width: 1920, height: 1080, duration: 60 }).format).toBe("shorts");
    expect(renderTestUtils.pickFormat("auto", { width: 1920, height: 1080, duration: 180 }).format).toBe("landscape");
    expect(renderTestUtils.pickFormat("auto", { width: 1920, height: 1080, duration: 0 }).format).toBe("landscape");
  });

  it("wraps overlay text and adds an ellipsis when content overflows", () => {
    expect(renderTestUtils.wrapOverlayText("  This is a much longer line than allowed  ", 8, 2)).toBe("This is\na much…");
    expect(renderTestUtils.wrapOverlayText("   ", 8, 2)).toBe("");
  });

  it("escapes ffmpeg filter values", () => {
    expect(renderTestUtils.escapeFilterValue("a:b,c[d]'e\\f")).toBe("a\\:b\\,c\\[d\\]\\\\'e\\\\f");
  });

  it("throws a clear error when no render font file is available", () => {
    expect(() => renderTestUtils.requireFontFile(null, "display")).toThrow("Render display font file is unavailable.");
  });
});
