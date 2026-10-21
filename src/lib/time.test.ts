import { describe, expect, it } from "vitest";
import {
  getLocalDateParts,
  getWeekBounds,
  isCrawlDue,
  isValidTimeZone,
  localMidnightUtc,
  shouldSendWeeklyDigest,
  toIsoDate,
} from "./time";

const ART = "America/Argentina/Buenos_Aires";
const TOKYO = "Asia/Tokyo";

// Monday 2026-10-19, 08:00 in Buenos Aires (UTC-3).
const MONDAY_8AM_ART = new Date("2026-10-19T11:00:00.000Z");

describe("getLocalDateParts", () => {
  it("reads the civil clock in the requested timezone", () => {
    const parts = getLocalDateParts(MONDAY_8AM_ART, ART);

    expect(parts).toMatchObject({ year: 2026, month: 10, day: 19, hour: 8, weekday: 1 });
  });

  it("returns a different weekday on the other side of the date line", () => {
    // 2026-10-18T23:00Z is Monday 08:00 in Tokyo and Sunday 20:00 in Buenos Aires.
    const instant = new Date("2026-10-18T23:00:00.000Z");

    expect(getLocalDateParts(instant, TOKYO).weekday).toBe(1);
    expect(getLocalDateParts(instant, ART).weekday).toBe(0);
  });
});

describe("shouldSendWeeklyDigest", () => {
  it("fires exactly on Monday 08:xx local time", () => {
    expect(shouldSendWeeklyDigest(MONDAY_8AM_ART, ART)).toBe(true);
    expect(shouldSendWeeklyDigest(new Date("2026-10-19T11:59:00.000Z"), ART)).toBe(true);
  });

  it("does not fire an hour early or late", () => {
    expect(shouldSendWeeklyDigest(new Date("2026-10-19T10:00:00.000Z"), ART)).toBe(false);
    expect(shouldSendWeeklyDigest(new Date("2026-10-19T12:00:00.000Z"), ART)).toBe(false);
  });

  it("does not fire on another weekday", () => {
    expect(shouldSendWeeklyDigest(new Date("2026-10-20T11:00:00.000Z"), ART)).toBe(false);
  });

  it("honours the client timezone", () => {
    const instant = new Date("2026-10-18T23:00:00.000Z");
    expect(shouldSendWeeklyDigest(instant, TOKYO)).toBe(true);
    expect(shouldSendWeeklyDigest(instant, ART)).toBe(false);
  });

  it("supports overriding the target slot", () => {
    expect(
      shouldSendWeeklyDigest(new Date("2026-10-20T11:00:00.000Z"), ART, { weekday: 2 }),
    ).toBe(true);
  });
});

describe("getWeekBounds", () => {
  it("returns Monday-based bounds and a readable label", () => {
    const bounds = getWeekBounds(new Date("2026-10-21T15:00:00.000Z"), ART);

    expect(bounds.weekStart).toBe("2026-10-19");
    expect(bounds.weekEnd).toBe("2026-10-21");
    expect(bounds.label).toBe("19/10 al 21/10");
  });

  it("starts at local midnight, not UTC midnight", () => {
    const bounds = getWeekBounds(new Date("2026-10-21T15:00:00.000Z"), ART);
    expect(bounds.startInstant).toBe("2026-10-19T03:00:00.000Z");

    const tokyo = getWeekBounds(new Date("2026-10-21T15:00:00.000Z"), TOKYO);
    expect(tokyo.startInstant).toBe("2026-10-18T15:00:00.000Z");
  });

  it("keeps Monday as the start when the week just began", () => {
    expect(getWeekBounds(MONDAY_8AM_ART, ART).weekStart).toBe("2026-10-19");
  });

  it("uses the client's local date, not UTC", () => {
    // Sunday 22:00 in Buenos Aires is already Monday in UTC.
    const bounds = getWeekBounds(new Date("2026-10-19T01:00:00.000Z"), ART);
    expect(bounds.weekStart).toBe("2026-10-12");
  });
});

describe("localMidnightUtc", () => {
  it("converts a civil date to the matching UTC instant", () => {
    expect(localMidnightUtc(2026, 10, 19, ART).toISOString()).toBe("2026-10-19T03:00:00.000Z");
    expect(localMidnightUtc(2026, 10, 19, TOKYO).toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });

  it("handles UTC itself", () => {
    expect(localMidnightUtc(2026, 10, 19, "UTC").toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });
});

describe("toIsoDate", () => {
  it("zero-pads month and day", () => {
    expect(toIsoDate({ year: 2026, month: 1, day: 5 })).toBe("2026-01-05");
  });
});

describe("isValidTimeZone", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone(ART)).toBe(true);
    expect(isValidTimeZone("Marte/Olympus")).toBe(false);
  });
});

describe("isCrawlDue", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");

  it("is due when it never ran", () => {
    expect(isCrawlDue(null, 7, now)).toBe(true);
  });

  it("is due after the interval elapsed", () => {
    expect(isCrawlDue("2026-10-14T11:00:00.000Z", 7, now)).toBe(true);
  });

  it("is not due before the interval elapsed", () => {
    expect(isCrawlDue("2026-10-20T12:00:00.000Z", 7, now)).toBe(false);
  });

  it("respects a custom cadence", () => {
    expect(isCrawlDue("2026-10-20T12:00:00.000Z", 1, now)).toBe(true);
  });
});
