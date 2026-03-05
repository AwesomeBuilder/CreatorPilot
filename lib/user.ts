import { prisma } from "@/lib/db";

const DEFAULT_TIMEZONE = "America/Los_Angeles";

export async function getOrCreateLocalUser() {
  const existing = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
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
