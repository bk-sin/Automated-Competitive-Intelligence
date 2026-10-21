/**
 * Timezone-aware scheduling helpers (FR-005: "Lunes a las 8:00 AM,
 * hora del cliente"). No date library: everything is civil-date math
 * driven by Intl, so DST is handled by the platform.
 */

export type LocalDateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
};

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
    weekday: WEEKDAYS[read("weekday")] ?? 0,
  };
}

export function toIsoDate(parts: Pick<LocalDateParts, "year" | "month" | "day">): string {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function civilToUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

function utcMsToCivil(ms: number): { year: number; month: number; day: number } {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** Offset (local - UTC) in ms for a given instant and zone, DST included. */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );

  return asUtc - date.getTime();
}

/** UTC instant that corresponds to 00:00 local time on the given civil date. */
export function localMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = civilToUtcMs(year, month, day);
  const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

/**
 * True when the client's local clock is inside the digest window.
 * The cron runs hourly, so a 59-minute window guarantees exactly one hit
 * per week per client (retries are deduplicated by the digests table).
 */
export function shouldSendWeeklyDigest(
  now: Date,
  timeZone: string,
  options: { weekday?: number; hour?: number } = {},
): boolean {
  const targetWeekday = options.weekday ?? 1; // Monday
  const targetHour = options.hour ?? 8;

  const local = getLocalDateParts(now, timeZone);
  return local.weekday === targetWeekday && local.hour === targetHour;
}

/** Monday-based week bounds for the client's local date. */
export function getWeekBounds(
  now: Date,
  timeZone: string,
): { weekStart: string; weekEnd: string; label: string; startInstant: string } {
  const local = getLocalDateParts(now, timeZone);
  const localMs = civilToUtcMs(local.year, local.month, local.day);
  const daysSinceMonday = (local.weekday + 6) % 7;

  const startMs = localMs - daysSinceMonday * 86_400_000;
  const endMs = localMs;

  const start = utcMsToCivil(startMs);
  const end = utcMsToCivil(endMs);

  return {
    weekStart: toIsoDate(start),
    weekEnd: toIsoDate(end),
    label: `${formatShortDate(start)} al ${formatShortDate(end)}`,
    // 00:00 local on the Monday, expressed as a UTC instant (used as a query bound).
    startInstant: localMidnightUtc(start.year, start.month, start.day, timeZone).toISOString(),
  };
}

function formatShortDate(parts: { year: number; month: number; day: number }): string {
  const day = String(parts.day).padStart(2, "0");
  const month = String(parts.month).padStart(2, "0");
  return `${day}/${month}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Weekly crawl cadence per competitor, configurable via crawl_interval_days. */
export function isCrawlDue(
  lastCrawledAt: string | null,
  intervalDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastCrawledAt) return true;
  const last = new Date(lastCrawledAt).getTime();
  if (Number.isNaN(last)) return true;
  const intervalMs = Math.max(1, intervalDays) * 86_400_000;
  return now.getTime() - last >= intervalMs;
}
