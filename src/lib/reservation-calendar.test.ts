import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  isoDate,
  mondayIndex,
  reservationMonths,
  weekdayNames,
} from "./reservation-calendar";

/**
 * The grid builder behind both reservation date pickers. Pure string and
 * calendar arithmetic, so everything here is exact — no clock, no
 * timezone, no `Date.now()`.
 */

/** Every date cell of a month, pad cells dropped. */
const cells = (weeks: { date: string | null }[][]): (string | null)[] =>
  weeks.flat().map((c) => c.date);
const realDates = (weeks: { date: string | null }[][]): string[] =>
  cells(weeks).filter((d): d is string => d !== null);
const openDates = (weeks: { date: string | null; available: boolean }[][]): string[] =>
  weeks
    .flat()
    .filter((c) => c.available)
    .map((c) => c.date as string);

describe("calendar arithmetic", () => {
  it("counts the days of a month, leap year included", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("indexes weekdays from Monday", () => {
    // 2026-09-21 was a Monday, 2026-09-27 the Sunday that closed that week.
    expect(mondayIndex(2026, 9, 21)).toBe(0);
    expect(mondayIndex(2026, 9, 27)).toBe(6);
  });

  it("zero-pads an ISO date", () => {
    expect(isoDate(2026, 1, 5)).toBe("2026-01-05");
    expect(isoDate(2026, 12, 31)).toBe("2026-12-31");
  });
});

describe("weekdayNames", () => {
  it("starts on Monday and returns seven names", () => {
    const en = weekdayNames("en-GB", "short");
    expect(en).toHaveLength(7);
    expect(en[0]).toMatch(/^Mon/);
    expect(en[6]).toMatch(/^Sun/);
  });

  it("follows the guest's language", () => {
    expect(weekdayNames("de-DE", "short")[0]).toMatch(/^Mo/);
    expect(weekdayNames("fr-FR", "short")[0]).toMatch(/^lun/);
    // An unusable tag degrades to English rather than throwing.
    expect(weekdayNames("not a locale", "short")).toHaveLength(7);
  });
});

describe("reservationMonths", () => {
  it("builds whole Monday-first weeks for the anchor month and the next", () => {
    const months = reservationMonths([], "2026-09-20");
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
    for (const month of months) {
      for (const week of month.weeks) expect(week).toHaveLength(7);
    }
    // September 2026 starts on a Tuesday → exactly one leading pad cell.
    const september = months[0]!;
    expect(september.weeks[0]![0]!.date).toBeNull();
    expect(september.weeks[0]![1]!.date).toBe("2026-09-01");
    expect(realDates(september.weeks)).toHaveLength(30);
    expect(realDates(september.weeks).at(-1)).toBe("2026-09-30");
  });

  it("names the month from a noon-UTC date, so no zone rolls it back", () => {
    const [september] = reservationMonths([], "2026-09-20");
    expect(september!.at.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    const label = new Intl.DateTimeFormat("de-DE", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    expect(label.format(september!.at)).toBe("September 2026");
  });

  it("marks exactly the reservable dates as available", () => {
    const months = reservationMonths(
      ["2026-09-21", "2026-09-22", "2026-10-05", "2027-01-01"],
      "2026-09-20",
    );
    expect(openDates(months[0]!.weeks)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(openDates(months[1]!.weeks)).toEqual(["2026-10-05"]);
    // A date outside the two rendered months simply isn't drawn.
    expect(realDates(months[1]!.weeks)).not.toContain("2027-01-01");
  });

  it("carries the year across December", () => {
    const months = reservationMonths([], "2026-12-10");
    expect(months.map((m) => m.key)).toEqual(["2026-12", "2027-01"]);
    expect(realDates(months[1]!.weeks)[0]).toBe("2027-01-01");
  });

  it("falls back to the earliest offered date when no anchor is given", () => {
    // The RN sheet has no venue timezone of its own, so it passes none.
    const months = reservationMonths(["2026-10-03", "2026-11-04"], null);
    expect(months.map((m) => m.key)).toEqual(["2026-10", "2026-11"]);
  });

  it("still draws the grids when nothing at all is bookable", () => {
    const months = reservationMonths([], "2026-09-20");
    expect(months).toHaveLength(2);
    expect(openDates(months[0]!.weeks)).toEqual([]);
  });

  it("returns nothing when it has neither an anchor nor a date", () => {
    expect(reservationMonths([])).toEqual([]);
  });

  it("ignores malformed entries rather than drawing a broken month", () => {
    const months = reservationMonths(["nope", "2026-09-21"], "2026-09-20");
    expect(openDates(months[0]!.weeks)).toEqual(["2026-09-21"]);
  });

  it("honours a wider window when asked for more months", () => {
    const months = reservationMonths([], "2026-09-20", 3);
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("covers a 60-day booking window with the leading month plus one", () => {
    // The point of the two grids: `RESERVATION_DAYS_AHEAD` is 60, and the
    // current month plus the next always spans at least 59 days from any
    // day of the month — so no offered date is unreachable for long.
    const days: string[] = [];
    const start = Date.UTC(2026, 8, 20);
    for (let i = 0; i < 60; i += 1) {
      days.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
    }
    const months = reservationMonths(days, "2026-09-20");
    const drawn = new Set(openDates(months[0]!.weeks).concat(openDates(months[1]!.weeks)));
    expect(drawn.has("2026-09-20")).toBe(true);
    expect(drawn.has("2026-10-31")).toBe(true);
    // November dates are past the two grids — the grid is the UI's own
    // horizon, deliberately narrower than the endpoint's.
    expect(drawn.has("2026-11-18")).toBe(false);
  });
});
