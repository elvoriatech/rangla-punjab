import { describe, expect, it } from "vitest";
import {
  ALL_DAYS,
  availableOnDayAt,
  daysFromForm,
  formatDays,
  isEveryDay,
  normaliseDays,
} from "./item-days";

const TZ = "Europe/Berlin";
// 2026-09-28 is a Monday.
const MON_NOON = new Date("2026-09-28T10:00:00Z"); // 12:00 Berlin
const SUN_2330_BERLIN = new Date("2026-09-27T21:30:00Z"); // Sun 23:30 Berlin
const MON_0030_BERLIN = new Date("2026-09-27T22:30:00Z"); // Mon 00:30 Berlin, still Sun in UTC

describe("normaliseDays", () => {
  it("dedupes and sorts valid days", () => {
    expect(normaliseDays([4, 0, 4, 2])).toEqual([0, 2, 4]);
  });

  it("reads malformed or empty input as every day — a dish must never silently vanish", () => {
    expect(normaliseDays(null)).toEqual([...ALL_DAYS]);
    expect(normaliseDays([])).toEqual([...ALL_DAYS]);
    expect(normaliseDays([7, -1, 1.5, "2"])).toEqual([...ALL_DAYS]);
  });
});

describe("availableOnDayAt", () => {
  it("every day is always on", () => {
    expect(availableOnDayAt([...ALL_DAYS], TZ, MON_NOON)).toBe(true);
  });

  it("uses Monday-first indexes", () => {
    expect(availableOnDayAt([0], TZ, MON_NOON)).toBe(true);
    expect(availableOnDayAt([1, 2, 3, 4, 5, 6], TZ, MON_NOON)).toBe(false);
  });

  it("reads the day in the venue's timezone, not UTC", () => {
    // Just after midnight in Berlin it is already Monday, though UTC says Sunday.
    expect(availableOnDayAt([0], TZ, MON_0030_BERLIN)).toBe(true);
    expect(availableOnDayAt([6], TZ, MON_0030_BERLIN)).toBe(false);
    expect(availableOnDayAt([6], TZ, SUN_2330_BERLIN)).toBe(true);
  });
});

describe("formatDays / isEveryDay", () => {
  it("keeps the list quiet for the usual every-day dish", () => {
    expect(isEveryDay([...ALL_DAYS])).toBe(true);
    expect(formatDays([...ALL_DAYS])).toBe("Every day");
  });

  it("names the chosen days, Monday first", () => {
    expect(isEveryDay([0, 2])).toBe(false);
    expect(formatDays([4, 0, 2])).toBe("Mon, Wed, Fri");
  });
});

describe("daysFromForm", () => {
  it("parses the check-box values", () => {
    expect(daysFromForm(["0", "3", "3", "6"])).toEqual([0, 3, 6]);
  });

  it("returns null when nothing (valid) is ticked, so the action can refuse it", () => {
    expect(daysFromForm([])).toBeNull();
    expect(daysFromForm(["9", "x"])).toBeNull();
  });
});
