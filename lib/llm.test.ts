import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { llmChatJSON, llmChatJSONWithUserContentDetailed, llmGenerateImage } from "@/lib/llm";

describe("llmChatJSON", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_MODEL_DEFAULT;
    delete process.env.LLM_MODEL_HARD;
    delete process.env.LLM_IMAGE_MODEL;
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

  it("uses the hard model first for heavy prompts and parses JSON from content-part responses", async () => {
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
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await llmChatJSON<Record<string, never>>({
      system: "Return only valid JSON",
      user: "x".repeat(24_100),
    });

    expect(result).toEqual({});
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).model).toBe("hard-model");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("generates an image through the same Gemini-compatible base URL", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://llm.example.com";
    process.env.LLM_IMAGE_MODEL = "image-model";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json: "ZmFrZS1pbWFnZQ==",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await llmGenerateImage({
      prompt: "Create a supporting still",
      size: "1024x1536",
    });

    expect(result).toEqual({ base64: "ZmFrZS1pbWFnZQ==" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example.com/images/generations",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      model: "image-model",
      prompt: "Create a supporting still",
      size: "1024x1536",
      n: 1,
      response_format: "b64_json",
    });
  });

  it("falls back to the native Gemini image endpoint when the OpenAI-compatible image route rejects the model", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    process.env.LLM_IMAGE_MODEL = "gemini-2.5-flash-image";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "models/gemini-2.5-flash-image is not found for API version v1main",
            },
          }),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "Generated image" },
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: "ZmFrZS1uYXRpdmUtaW1hZ2U=",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await llmGenerateImage({
      prompt: "Create a supporting still",
      size: "1024x1536",
    });

    expect(result).toEqual({ base64: "ZmFrZS1uYXRpdmUtaW1hZ2U=" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/images/generations");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=test-key",
    );
  });

  it("includes a response preview when the model returns invalid JSON text", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL_DEFAULT = "default-model";
    process.env.LLM_MODEL_HARD = "default-model";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: '```json\n{"visualSummary":"ok",}\n```',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await llmChatJSONWithUserContentDetailed<Record<string, unknown>>({
      system: "Return only valid JSON",
      userContent: "Inspect this screenshot",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.responsePreview).toContain('{"visualSummary":"ok",}');
  });
});
