import { z } from "zod";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-2.5-pro";
const DEFAULT_HARD_MODEL = "gemini-3.1-pro-preview";
const HARD_PROMPT_CHAR_THRESHOLD = 24_000;
const HARD_PROMPT_SOURCE_THRESHOLD = 12;

export type ChatContentPart = {
  type: string;
  [key: string]: unknown;
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

export function hasLlmConfig() {
  return Boolean(process.env.LLM_API_KEY);
}

function resolveModels() {
  const defaultModel = process.env.LLM_MODEL_DEFAULT ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
  const hardModel = process.env.LLM_MODEL_HARD ?? DEFAULT_HARD_MODEL;
  return {
    defaultModel,
    hardModel,
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
  if (!hasLlmConfig()) {
    return null;
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return null;
  }

  const baseUrl = process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL;
  const { defaultModel, hardModel } = resolveModels();
  const hardFirst = isHardPrompt(params);
  const attemptOrder = hardFirst ? [hardModel, defaultModel] : [defaultModel, hardModel];
  const models = [...new Set(attemptOrder.filter(Boolean))];

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
        continue;
      }

      const json = ChatCompletionResponseSchema.parse(await response.json());
      const content = json.choices[0]?.message.content;

      if (typeof content !== "string") {
        continue;
      }

      const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      return JSON.parse(cleaned) as T;
    } catch {
      continue;
    }
  }

  return null;
}
