import { prisma } from "@/lib/db";
import { DEFAULT_TIMEZONE } from "@/lib/profile-options";

export const LOCAL_USER_ID = "local-user";

export async function getOrCreateLocalUser() {
  const localUser = await prisma.user.findUnique({
    where: { id: LOCAL_USER_ID },
  });

  if (localUser) {
    return localUser;
  }

  const existing = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      id: LOCAL_USER_ID,
      timezone: DEFAULT_TIMEZONE,
    },
  });
}

export async function resolveUser(req?: Request) {
  if (!req) {
    return getOrCreateLocalUser();
  }

  const headerUserId = req.headers.get("x-user-id");
  if (headerUserId) {
    const headerUser = await prisma.user.findUnique({ where: { id: headerUserId } });
    if (headerUser) {
      return headerUser;
    }
  }

  return getOrCreateLocalUser();
}

export function getDefaultTimezone() {
  return DEFAULT_TIMEZONE;
}
