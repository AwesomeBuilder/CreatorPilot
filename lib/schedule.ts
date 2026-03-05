import type { ScheduleRecommendation } from "@/lib/types";

function getLocalParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    weekday: map.weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function isWeekday(weekday: string) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
}

export function recommendPublishTime(timezone: string): ScheduleRecommendation {
  const now = new Date();
  const scanStart = new Date(now.getTime() + 30 * 60 * 1000);
  const maxChecks = 14 * 48;

  for (let i = 0; i < maxChecks; i += 1) {
    const candidate = new Date(scanStart.getTime() + i * 30 * 60 * 1000);
    const local = getLocalParts(candidate, timezone);

    const inWindow = local.hour >= 17 && local.hour < 20;
    if (isWeekday(local.weekday) && inWindow) {
      const reason =
        "Recommended for the next weekday early-evening window (5-8pm local), when creator audiences are typically more active.";

      return {
        publishAt: candidate.toISOString(),
        reason,
        timezone,
      };
    }
  }

  const fallback = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    publishAt: fallback.toISOString(),
    reason: "Fallback recommendation because no weekday evening slot was found in the next two weeks.",
    timezone,
  };
}
