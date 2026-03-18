type ParsedApiResponse<T> = {
  data: T | null;
  text: string;
  contentType: string | null;
};

function extractErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const message = (payload as { error?: unknown }).error;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
}

export async function readApiResponse<T>(response: Response): Promise<ParsedApiResponse<T>> {
  const contentType = response.headers.get("content-type");
  const rawText = await response.text();

  if (contentType?.toLowerCase().includes("application/json") && rawText.trim().length > 0) {
    try {
      return {
        data: JSON.parse(rawText) as T,
        text: rawText,
        contentType,
      };
    } catch {
      return {
        data: null,
        text: rawText,
        contentType,
      };
    }
  }

  return {
    data: null,
    text: rawText,
    contentType,
  };
}

export function formatApiErrorMessage(params: {
  response: Response;
  payload?: unknown;
  text?: string;
  fallback: string;
}) {
  const payloadMessage = extractErrorMessage(params.payload);
  if (payloadMessage) {
    return payloadMessage;
  }

  const trimmedText = params.text?.trim();
  const contentType = params.response.headers.get("content-type")?.toLowerCase() ?? "";

  if (trimmedText) {
    if (contentType.includes("text/html")) {
      return `Request failed with HTTP ${params.response.status}. The server returned HTML instead of JSON.`;
    }

    return trimmedText;
  }

  const statusText = params.response.statusText.trim();
  if (statusText.length > 0) {
    return `Request failed with HTTP ${params.response.status}: ${statusText}`;
  }

  return params.fallback;
}
