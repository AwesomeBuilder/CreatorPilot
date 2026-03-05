export const NICHE_VALUES = ["AI & Tech", "Business & Finance", "Creator Economy", "General / Mixed"] as const;

export const TIMEZONE_VALUES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
] as const;

export const DEFAULT_TIMEZONE = TIMEZONE_VALUES[0];

export const NICHE_OPTIONS = NICHE_VALUES.map((value) => ({
  value,
  label: value,
}));

export const TIMEZONE_OPTIONS = TIMEZONE_VALUES.map((value) => ({
  value,
  label: value,
}));
