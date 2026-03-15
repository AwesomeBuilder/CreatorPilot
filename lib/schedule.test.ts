import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recommendPublishTime } from "@/lib/schedule";

function getLocalWeekdayAndHour(iso: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));

  return {
    weekday: parts.weekday,
    hour: Number(parts.hour),
  };
}

describe("recommendPublishTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks the next weekday evening slot in the requested timezone", () => {
    vi.setSystemTime(new Date("2026-03-16T22:10:00.000Z"));

    const schedule = recommendPublishTime("America/Los_Angeles");
    const local = getLocalWeekdayAndHour(schedule.publishAt, schedule.timezone);

    expect(schedule.timezone).toBe("America/Los_Angeles");
    expect(local.weekday).toBe("Mon");
    expect(local.hour).toBeGreaterThanOrEqual(17);
    expect(local.hour).toBeLessThan(20);
  });

  it("skips weekends and moves to the next weekday evening window", () => {
    vi.setSystemTime(new Date("2026-03-14T20:00:00.000Z"));

    const schedule = recommendPublishTime("America/Los_Angeles");
    const local = getLocalWeekdayAndHour(schedule.publishAt, schedule.timezone);

    expect(local.weekday).toBe("Mon");
    expect(local.hour).toBeGreaterThanOrEqual(17);
    expect(local.hour).toBeLessThan(20);
  });
});
