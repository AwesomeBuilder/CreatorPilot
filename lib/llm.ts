import { z } from "zod";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

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
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_MODEL);
}

export async function llmChatJSON<T>(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<T | null> {
  if (!hasLlmConfig()) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(`${process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        temperature: params.temperature ?? 0.4,
        messages: [
          {
            role: "system",
            content: `${params.system}\nReturn ONLY valid JSON with no markdown.`,
          },
          {
            role: "user",
            content: params.user,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const json = ChatCompletionResponseSchema.parse(await response.json());
    const content = json.choices[0]?.message.content;

    if (typeof content !== "string") {
      return null;
    }

    const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
