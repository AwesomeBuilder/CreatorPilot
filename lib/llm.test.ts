import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { llmChatJSON } from "@/lib/llm";

describe("llmChatJSON", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_MODEL_DEFAULT;
    delete process.env.LLM_MODEL_HARD;
    delete process.env.LLM_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null without an LLM API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await llmChatJSON<{ ok: boolean }>({
      system: "system",
      user: "user",
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the default model first and falls back to the hard model when needed", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL_DEFAULT = "default-model";
    process.env.LLM_MODEL_HARD = "hard-model";
    process.env.LLM_BASE_URL = "https://llm.example.com";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '```json\n{"ok":true}\n```',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await llmChatJSON<{ ok: boolean }>({
      system: "Return only valid JSON",
      user: "A short prompt",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://llm.example.com/chat/completions",
      expect.any(Object),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).model).toBe("default-model");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string).model).toBe("hard-model");
  });

  it("uses the hard model first for heavy prompts and skips invalid non-string content", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL_DEFAULT = "default-model";
    process.env.LLM_MODEL_HARD = "hard-model";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: [{ type: "output_text", text: "{}" }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '{"fallback":true}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await llmChatJSON<{ fallback: boolean }>({
      system: "Return only valid JSON",
      user: "x".repeat(24_100),
    });

    expect(result).toEqual({ fallback: true });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).model).toBe("hard-model");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string).model).toBe("default-model");
  });
});
