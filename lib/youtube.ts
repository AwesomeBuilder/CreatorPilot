import fs from "node:fs";

import { google } from "googleapis";

import { prisma } from "@/lib/db";

const PROVIDER = "youtube";
const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

type UploadParams = {
  userId: string;
  videoPath: string;
  title: string;
  description: string;
  tags?: string[];
  publishAt?: string;
};

function oauthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function isYoutubeMockMode() {
  if (process.env.YOUTUBE_UPLOAD_MOCK === "true") {
    return true;
  }

  return !oauthConfigured();
}

function getOAuthClient() {
  if (!oauthConfigured()) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

type GoogleApiErrorShape = Error & {
  code?: number;
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{
          message?: string;
          reason?: string;
        }>;
      };
    };
  };
};

function normalizeYoutubeUploadError(error: unknown) {
  const candidate = error as GoogleApiErrorShape;
  const googleError = candidate.response?.data?.error;
  const reason = googleError?.errors?.[0]?.reason;
  const message = googleError?.errors?.[0]?.message ?? googleError?.message ?? candidate.message;

  if (reason === "youtubeSignupRequired") {
    return new Error(
      "The connected Google account does not have a YouTube channel yet. Open YouTube with that account, create the channel, then reconnect and retry.",
    );
  }

  if (reason === "insufficientPermissions") {
    return new Error("The current YouTube connection is missing upload permissions. Reconnect YouTube and approve the requested access.");
  }

  if (candidate.response?.status === 401) {
    return new Error("The YouTube connection was rejected by Google. Reconnect YouTube with the correct account and retry.");
  }

  return new Error(message ?? "YouTube upload failed.");
}

function serializeState(userId: string) {
  return Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64url");
}

function parseState(state?: string | null) {
  if (!state) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { userId?: string };
    return parsed.userId ?? null;
  } catch {
    return null;
  }
}

export async function getYoutubeAuthUrl(userId: string) {
  if (isYoutubeMockMode()) {
    return null;
  }

  const client = getOAuthClient();

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [YOUTUBE_UPLOAD_SCOPE],
    state: serializeState(userId),
  });
}

export async function completeYoutubeOAuth(params: { code: string; fallbackUserId: string; state?: string | null }) {
  const client = getOAuthClient();

  const userId = parseState(params.state) ?? params.fallbackUserId;
  const tokenResponse = await client.getToken(params.code);
  const tokens = tokenResponse.tokens;

  await prisma.oAuthCredential.upsert({
    where: {
      userId_provider: {
        userId,
        provider: PROVIDER,
      },
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      scope: tokens.scope,
      tokenType: tokens.token_type,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    create: {
      userId,
      provider: PROVIDER,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope,
      tokenType: tokens.token_type,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });

  return userId;
}

export async function getYoutubeConnectionStatus(userId: string) {
  if (isYoutubeMockMode()) {
    return {
      connected: false,
      mode: "mock" as const,
      reason:
        process.env.YOUTUBE_UPLOAD_MOCK === "true"
          ? "YOUTUBE_UPLOAD_MOCK=true"
          : "OAuth env vars not fully configured",
    };
  }

  const credential = await prisma.oAuthCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: PROVIDER,
      },
    },
  });

  return {
    connected: Boolean(credential?.refreshToken || credential?.accessToken),
    mode: "live" as const,
    reason: credential ? "Connected" : "Not connected",
  };
}

async function createAuthenticatedYoutubeClient(userId: string) {
  const credential = await prisma.oAuthCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: PROVIDER,
      },
    },
  });

  if (!credential) {
    throw new Error("YouTube OAuth is not connected for this user.");
  }

  const oauthClient = getOAuthClient();

  oauthClient.setCredentials({
    access_token: credential.accessToken ?? undefined,
    refresh_token: credential.refreshToken ?? undefined,
    expiry_date: credential.expiryDate?.getTime(),
    token_type: credential.tokenType ?? undefined,
    scope: credential.scope ?? undefined,
  });

  oauthClient.on("tokens", async (tokens) => {
    await prisma.oAuthCredential.update({
      where: {
        userId_provider: {
          userId,
          provider: PROVIDER,
        },
      },
      data: {
        accessToken: tokens.access_token ?? credential.accessToken,
        refreshToken: tokens.refresh_token ?? credential.refreshToken,
        scope: tokens.scope ?? credential.scope,
        tokenType: tokens.token_type ?? credential.tokenType,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : credential.expiryDate,
      },
    });
  });

  return google.youtube({
    version: "v3",
    auth: oauthClient,
  });
}

export async function uploadVideoToYoutube(params: UploadParams) {
  if (isYoutubeMockMode()) {
    return {
      mode: "mock" as const,
      videoId: `mock_${Date.now()}`,
      privacyStatus: "private",
      scheduledPublishAt: params.publishAt ?? null,
    };
  }

  const youtube = await createAuthenticatedYoutubeClient(params.userId);

  const requestBodyBase = {
    snippet: {
      title: params.title,
      description: params.description,
      tags: params.tags?.slice(0, 20),
    },
    status: {
      privacyStatus: "private" as const,
      publishAt: params.publishAt,
    },
  };

  const makeRequest = async (withSchedule: boolean) => {
    const requestBody = {
      ...requestBodyBase,
      status: {
        ...requestBodyBase.status,
        publishAt: withSchedule ? params.publishAt : undefined,
      },
    };

    return youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody,
      media: {
        body: fs.createReadStream(params.videoPath),
      },
    });
  };

  try {
    const response = await makeRequest(Boolean(params.publishAt));

    return {
      mode: "live" as const,
      videoId: response.data.id,
      privacyStatus: response.data.status?.privacyStatus ?? "private",
      scheduledPublishAt: response.data.status?.publishAt ?? null,
      url: response.data.id ? `https://www.youtube.com/watch?v=${response.data.id}` : null,
    };
  } catch (error) {
    if (!params.publishAt) {
      throw normalizeYoutubeUploadError(error);
    }

    try {
      const fallbackResponse = await makeRequest(false);
      return {
        mode: "live" as const,
        videoId: fallbackResponse.data.id,
        privacyStatus: fallbackResponse.data.status?.privacyStatus ?? "private",
        scheduledPublishAt: null,
        scheduleNote: "Scheduling was not applied; uploaded as private.",
        url: fallbackResponse.data.id ? `https://www.youtube.com/watch?v=${fallbackResponse.data.id}` : null,
      };
    } catch (fallbackError) {
      throw normalizeYoutubeUploadError(fallbackError);
    }
  }
}
