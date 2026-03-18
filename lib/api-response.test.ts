import { describe, expect, it } from "vitest";

import { formatApiErrorMessage, readApiResponse } from "@/lib/api-response";

describe("readApiResponse", () => {
  it("parses JSON responses", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
      },
    });

    const parsed = await readApiResponse<{ ok: boolean }>(response);

    expect(parsed.data).toEqual({ ok: true });
    expect(parsed.text).toBe('{"ok":true}');
  });

  it("preserves non-JSON response bodies as text", async () => {
    const response = new Response("<html>413</html>", {
      status: 413,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });

    const parsed = await readApiResponse(response);

    expect(parsed.data).toBeNull();
    expect(parsed.text).toBe("<html>413</html>");
  });
});

describe("formatApiErrorMessage", () => {
  it("prefers the API error field when available", () => {
    const response = new Response(null, {
      status: 400,
      headers: {
        "content-type": "application/json",
      },
    });

    expect(
      formatApiErrorMessage({
        response,
        payload: { error: "Upload failed" },
        fallback: "Fallback",
      }),
    ).toBe("Upload failed");
  });

  it("turns HTML error pages into a readable message", () => {
    const response = new Response("<html>broken</html>", {
      status: 500,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });

    expect(
      formatApiErrorMessage({
        response,
        text: "<html>broken</html>",
        fallback: "Fallback",
      }),
    ).toBe("Request failed with HTTP 500. The server returned HTML instead of JSON.");
  });
});
