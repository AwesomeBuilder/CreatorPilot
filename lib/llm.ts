import { z } from "zod";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-2.5-pro";
const DEFAULT_HARD_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_TTS_VOICE = "Kore";
const HARD_PROMPT_CHAR_THRESHOLD = 24_000;
const HARD_PROMPT_SOURCE_THRESHOLD = 12;

export type ChatContentPart = {
  type: string;
  [key: string]: unknown;
};

export type LlmStructuredResult<T> = {
  data: T | null;
  error: string | null;
  modelUsed?: string;
  attemptedModels: string[];
  responsePreview?: string | null;
};

export type LlmImageResult = {
  base64: string | null;
  error: string | null;
  modelUsed?: string;
};

export type LlmSpeechResult = {
  pcmBase64: string | null;
  mimeType: string | null;
  error: string | null;
  modelUsed?: string;
};

const ChatMessageSchema = z.object({
  role: z.enum(["assistant", "user", "system"]),
  content: z.union([
    z.string(),
    z.array(
      z.object({
        type: z.string(),
      }).passthrough(),
    ),
  ]),
});

const ChatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: ChatMessageSchema,
    }),
  ),
});

const ImageGenerationResponseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .default([]),
});

const GeminiInlineDataSchema = z.object({
  mimeType: z.string().optional(),
  data: z.string().optional(),
});

const GeminiGenerateContentResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z
                  .object({
                    text: z.string().optional(),
                    inlineData: GeminiInlineDataSchema.optional(),
                  })
                  .passthrough(),
              )
              .default([]),
          })
          .optional(),
      }),
    )
    .default([]),
});

export function hasLlmConfig() {
  return Boolean(process.env.LLM_API_KEY);
}

function resolveBaseUrl() {
  return process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL;
}

function resolveApiKey() {
  return process.env.LLM_API_KEY ?? null;
}

function canUseNativeGeminiEndpoint(baseUrl: string) {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

function resolveModels() {
  const defaultModel = process.env.LLM_MODEL_DEFAULT ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
  const hardModel = process.env.LLM_MODEL_HARD ?? DEFAULT_HARD_MODEL;
  const imageModel = process.env.LLM_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
  const ttsModel = process.env.LLM_TTS_MODEL ?? DEFAULT_TTS_MODEL;
  const ttsVoice = process.env.LLM_TTS_VOICE ?? DEFAULT_TTS_VOICE;
  return {
    defaultModel,
    hardModel,
    imageModel,
    ttsModel,
    ttsVoice,
  };
}

function contentToPromptString(content: string | ChatContentPart[]) {
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content);
}

function isHardPrompt(params: { system: string; userContent: string | ChatContentPart[] }) {
  const joined = `${params.system}\n${contentToPromptString(params.userContent)}`;
  const sourceCount = (joined.match(/https?:\/\//g) ?? []).length;
  const hasSchemaLikeConstraints = /outputSchema|return only valid json|exactly \d+/i.test(joined);
  return (
    joined.length > HARD_PROMPT_CHAR_THRESHOLD ||
    sourceCount > HARD_PROMPT_SOURCE_THRESHOLD ||
    (hasSchemaLikeConstraints && joined.length > 8_000)
  );
}

async function requestCompletion(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  userContent: string | ChatContentPart[];
  temperature: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    return await fetch(`${params.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        temperature: params.temperature,
        messages: [
          {
            role: "system",
            content: `${params.system}\nReturn ONLY valid JSON with no markdown.`,
          },
          {
            role: "user",
            content: params.userContent,
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function shortenErrorMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 220);
}

function extractTextFromContent(content: string | ChatContentPart[] | undefined) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textParts = content
    .map((part) => {
      if (typeof part.text === "string") {
        return part.text;
      }

      if (typeof part.output_text === "string") {
        return part.output_text;
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));

  return textParts.length > 0 ? textParts.join("\n") : null;
}

function summarizeContentShape(content: string | ChatContentPart[] | undefined) {
  if (typeof content === "string") {
    return "plain text";
  }

  if (!Array.isArray(content)) {
    return "empty content";
  }

  const partTypes = content.map((part) => String(part.type ?? "unknown")).slice(0, 6);
  return `content parts: ${partTypes.join(", ")}`;
}

function summarizeResponsePreview(text: string) {
  return shortenErrorMessage(text.replace(/\s+/g, " ").trim());
}

function aspectRatioForSize(size: "1024x1024" | "1536x1024" | "1024x1536") {
  if (size === "1536x1024") {
    return "3:2";
  }

  if (size === "1024x1536") {
    return "2:3";
  }

  return "1:1";
}

async function requestGeminiNativeImage(params: {
  apiKey: string;
  model: string;
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: params.prompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: aspectRatioForSize(params.size),
          },
        },
      }),
    },
  );

  if (!response.ok) {
    return {
      base64: null,
      error: extractApiError(await readResponseText(response), response.status, params.model),
      modelUsed: params.model,
    };
  }

  const json = GeminiGenerateContentResponseSchema.parse(await response.json());
  const parts = json.candidates.flatMap((candidate) => candidate.content?.parts ?? []);
  const inlineImage = parts.find((part) => typeof part.inlineData?.data === "string" && part.inlineData.data.length > 0);

  if (!inlineImage?.inlineData?.data) {
    const textPreview = parts
      .map((part) => (typeof part.text === "string" ? part.text : null))
      .filter((value): value is string => Boolean(value))
      .join(" ");
    return {
      base64: null,
      error: textPreview
        ? `Model ${params.model} returned native Gemini content without image data: ${summarizeResponsePreview(textPreview)}`
        : `Model ${params.model} did not return inline image data from native Gemini.`,
      modelUsed: params.model,
    };
  }

  return {
    base64: inlineImage.inlineData.data,
    error: null,
    modelUsed: params.model,
  };
}

function extractApiError(text: string, status: number, model: string) {
  if (!text) {
    return `Model ${model} returned HTTP ${status}.`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    const message = parsed.error?.message;
    if (message) {
      return shortenErrorMessage(`Model ${model} returned HTTP ${status}: ${message}`);
    }
  } catch {
    // Fall through to the raw text branch.
  }

  return shortenErrorMessage(`Model ${model} returned HTTP ${status}: ${text}`);
}

export async function llmChatJSON<T>(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<T | null> {
  return llmChatJSONWithUserContent<T>({
    system: params.system,
    userContent: params.user,
    temperature: params.temperature,
  });
}

export async function llmChatJSONWithUserContent<T>(params: {
  system: string;
  userContent: string | ChatContentPart[];
  temperature?: number;
}): Promise<T | null> {
  const result = await llmChatJSONWithUserContentDetailed<T>(params);
  return result.data;
}

export async function llmChatJSONWithUserContentDetailed<T>(params: {
  system: string;
  userContent: string | ChatContentPart[];
  temperature?: number;
}): Promise<LlmStructuredResult<T>> {
  if (!hasLlmConfig()) {
    return {
      data: null,
      error: "LLM_API_KEY is missing, so multimodal analysis could not run.",
      attemptedModels: [],
    };
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      data: null,
      error: "LLM_API_KEY is missing, so multimodal analysis could not run.",
      attemptedModels: [],
    };
  }

  const baseUrl = resolveBaseUrl();
  const { defaultModel, hardModel } = resolveModels();
  const hardFirst = isHardPrompt(params);
  const attemptOrder = hardFirst ? [hardModel, defaultModel] : [defaultModel, hardModel];
  const models = [...new Set(attemptOrder.filter(Boolean))];
  let lastError = "The model did not return structured JSON.";
  let lastPreview: string | null = null;

  for (const model of models) {
    try {
      const response = await requestCompletion({
        baseUrl,
        apiKey,
        model,
        system: params.system,
        userContent: params.userContent,
        temperature: params.temperature ?? 0.4,
      });

      if (!response.ok) {
        lastError = extractApiError(await readResponseText(response), response.status, model);
        continue;
      }

      const json = ChatCompletionResponseSchema.parse(await response.json());
      const content = json.choices[0]?.message.content;
      const textContent = extractTextFromContent(content);

      if (!textContent) {
        lastError = `Model ${model} returned ${summarizeContentShape(content)}, so structured vision analysis could not be parsed.`;
        lastPreview = null;
        continue;
      }

      const cleaned = textContent.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      try {
        return {
          data: JSON.parse(cleaned) as T,
          error: null,
          modelUsed: model,
          attemptedModels: models,
          responsePreview: summarizeResponsePreview(cleaned),
        };
      } catch {
        lastError = `Model ${model} returned invalid JSON, so structured vision analysis could not be parsed.`;
        lastPreview = summarizeResponsePreview(cleaned);
      }
    } catch (error) {
      lastError =
        error instanceof Error
          ? shortenErrorMessage(`Model ${model} request failed: ${error.message}`)
          : `Model ${model} request failed during structured analysis.`;
      lastPreview = null;
      continue;
    }
  }

  return {
    data: null,
    error: lastError,
    attemptedModels: models,
    responsePreview: lastPreview,
  };
}

export async function llmGenerateImage(params: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
}): Promise<{ base64: string } | null> {
  const result = await llmGenerateImageDetailed(params);
  return result.base64 ? { base64: result.base64 } : null;
}

export async function llmGenerateImageDetailed(params: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
}): Promise<LlmImageResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      base64: null,
      error: "LLM_API_KEY is missing, so generated supporting visuals are unavailable.",
    };
  }

  const baseUrl = resolveBaseUrl();
  const { imageModel } = resolveModels();
  const candidateModels = [...new Set([imageModel, DEFAULT_IMAGE_MODEL].filter(Boolean))];
  const requestedSize = params.size ?? "1024x1536";
  let lastError = "Generated image request failed.";

  for (const model of candidateModels) {
    try {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt: params.prompt,
          size: requestedSize,
          n: 1,
          response_format: "b64_json",
        }),
      });

      if (!response.ok) {
        lastError = extractApiError(await readResponseText(response), response.status, model);
        continue;
      }

      const json = ImageGenerationResponseSchema.parse(await response.json());
      const image = json.data[0];

      if (image?.b64_json) {
        return {
          base64: image.b64_json,
          error: null,
          modelUsed: model,
        };
      }

      if (image?.url) {
        const imageResponse = await fetch(image.url);
        if (!imageResponse.ok) {
          lastError = `Generated image URL fetch failed with HTTP ${imageResponse.status}.`;
          continue;
        }

        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        return {
          base64: bytes.toString("base64"),
          error: null,
          modelUsed: model,
        };
      }

      lastError = `Model ${model} did not return image data.`;
    } catch (error) {
      lastError =
        error instanceof Error
          ? shortenErrorMessage(`Image generation request failed for ${model}: ${error.message}`)
          : `Image generation request failed for ${model}.`;
    }
  }

  if (canUseNativeGeminiEndpoint(baseUrl)) {
    for (const model of candidateModels) {
      try {
        const nativeResult = await requestGeminiNativeImage({
          apiKey,
          model,
          prompt: params.prompt,
          size: requestedSize,
        });

        if (nativeResult.base64) {
          return nativeResult;
        }

        lastError = nativeResult.error ?? lastError;
      } catch (error) {
        lastError =
          error instanceof Error
            ? shortenErrorMessage(`Native Gemini image generation failed for ${model}: ${error.message}`)
            : `Native Gemini image generation failed for ${model}.`;
      }
    }
  }

  return {
    base64: null,
    error: lastError,
    modelUsed: candidateModels[0],
  };
}

export async function llmGenerateSpeechDetailed(params: {
  text: string;
}): Promise<LlmSpeechResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      pcmBase64: null,
      mimeType: null,
      error: "LLM_API_KEY is missing, so generated narration is unavailable.",
    };
  }

  const { ttsModel, ttsVoice } = resolveModels();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ttsModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Say in a clear, natural, professional voice: ${params.text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: ttsVoice,
                },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      return {
        pcmBase64: null,
        mimeType: null,
        error: extractApiError(await readResponseText(response), response.status, ttsModel),
        modelUsed: ttsModel,
      };
    }

    const json = GeminiGenerateContentResponseSchema.parse(await response.json());
    const parts = json.candidates.flatMap((candidate) => candidate.content?.parts ?? []);
    const audioPart = parts.find((part) => typeof part.inlineData?.data === "string" && String(part.inlineData?.mimeType ?? "").startsWith("audio/"));

    if (!audioPart?.inlineData?.data) {
      return {
        pcmBase64: null,
        mimeType: null,
        error: `Model ${ttsModel} did not return audio data.`,
        modelUsed: ttsModel,
      };
    }

    return {
      pcmBase64: audioPart.inlineData.data,
      mimeType: audioPart.inlineData.mimeType ?? null,
      error: null,
      modelUsed: ttsModel,
    };
  } catch (error) {
    return {
      pcmBase64: null,
      mimeType: null,
      error:
        error instanceof Error
          ? shortenErrorMessage(`Speech generation request failed for ${ttsModel}: ${error.message}`)
          : `Speech generation request failed for ${ttsModel}.`,
      modelUsed: ttsModel,
    };
  }
}
