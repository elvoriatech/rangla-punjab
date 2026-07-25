import { describe, expect, it } from "vitest";
import { pickActiveMenu, type MenuForResolver } from "./schedule";

/**
 * Table-driven test for the active-menu resolver. Each row asserts which
 * menu wins at a given UTC instant + timezone against a fixed fixture:
 *
 *   default  — always-on fallback (schedule = {})
 *   lunch    — 11:00–15:00 in local tz, Mon-Fri
 *   dinner   — 17:00–22:00 in local tz, every day
 *   late     — 22:00–02:00 (wraps midnight), Fri + Sat
 *
 * DST edges are covered by rows whose UTC instant sits inside or straddles
 * the CET/CEST switch — the resolver must interpret schedules in local
 * wall-clock time on both sides.
 */

const menus: MenuForResolver[] = [
  { id: "default", isDefault: true, schedule: {} },
  {
    id: "lunch",
    isDefault: false,
    schedule: { windows: [{ days: [1, 2, 3, 4, 5], start: "11:00", end: "15:00" }] },
  },
  {
    id: "dinner",
    isDefault: false,
    schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "17:00", end: "22:00" }] },
  },
  {
    id: "late",
    isDefault: false,
    schedule: { windows: [{ days: [5, 6], start: "22:00", end: "02:00" }] },
  },
];

type Case = {
  desc: string;
  utc: string; // ISO instant
  tz: string;
  expected: string;
};

const cases: Case[] = [
  {
    desc: "Weekday lunchtime in Berlin (winter) → lunch",
    utc: "2026-01-14T11:30:00Z", // Wed 12:30 CET
    tz: "Europe/Berlin",
    expected: "lunch",
  },
  {
    desc: "Weekday morning in Berlin (before lunch) → default",
    utc: "2026-01-14T08:30:00Z", // Wed 09:30 CET
    tz: "Europe/Berlin",
    expected: "default",
  },
  {
    desc: "Weekend at lunchtime in Berlin → default (lunch is weekdays only)",
    utc: "2026-01-17T12:30:00Z", // Sat 13:30 CET
    tz: "Europe/Berlin",
    expected: "default",
  },
  {
    desc: "Weekday dinner in Berlin → dinner",
    utc: "2026-01-14T17:30:00Z", // Wed 18:30 CET
    tz: "Europe/Berlin",
    expected: "dinner",
  },
  {
    desc: "Late Saturday night (before midnight) → late (wraps midnight)",
    utc: "2026-01-17T22:30:00Z", // Sat 23:30 CET
    tz: "Europe/Berlin",
    expected: "late",
  },
  {
    desc: "Just after midnight Sunday morning → late (still inside wrap)",
    utc: "2026-01-18T00:30:00Z", // Sun 01:30 CET
    tz: "Europe/Berlin",
    expected: "late",
  },
  {
    desc: "Post-late-window Sunday morning → default",
    utc: "2026-01-18T02:00:00Z", // Sun 03:00 CET
    tz: "Europe/Berlin",
    expected: "default",
  },
  {
    desc: "Berlin DST spring-forward: 09:30 UTC = 11:30 CEST → lunch",
    // Last Sun of March 2026 = 2026-03-29. 01:00 UTC that day is 02:00 CET,
    // then clocks jump to 03:00 CEST. This instant sits well after, so
    // local is CEST (+2).
    utc: "2026-03-30T09:30:00Z", // Mon 11:30 CEST
    tz: "Europe/Berlin",
    expected: "lunch",
  },
  {
    desc: "Berlin DST fall-back: 12:30 UTC = 13:30 CET (winter) → lunch",
    // Last Sun of October 2026 = 2026-10-25. This instant is Mon Oct 26,
    // firmly after the fall-back, so local is CET (+1).
    utc: "2026-10-26T12:30:00Z",
    tz: "Europe/Berlin",
    expected: "lunch",
  },
  {
    desc: "New York lunchtime (12:30 EST) → lunch, tz-shifted from UTC",
    utc: "2026-01-14T17:30:00Z", // Wed 12:30 EST
    tz: "America/New_York",
    expected: "lunch",
  },
];

describe("pickActiveMenu (schedule + tz)", () => {
  it.each(cases)("$desc", ({ utc, tz, expected }) => {
    const active = pickActiveMenu(menus, new Date(utc), tz);
    expect(active?.id).toBe(expected);
  });

  it("returns null when nothing matches and there is no default", () => {
    const noDefault: MenuForResolver[] = [
      {
        id: "only-lunch",
        isDefault: false,
        schedule: { windows: [{ days: [1], start: "11:00", end: "15:00" }] },
      },
    ];
    // Tuesday — the "only-lunch" window is Monday-only.
    expect(pickActiveMenu(noDefault, new Date("2026-01-13T12:00:00Z"), "Europe/Berlin")).toBeNull();
  });

  it("treats malformed schedule JSON as always-no-match (falls through to default)", () => {
    const menusWithGarbage: MenuForResolver[] = [
      { id: "default", isDefault: true, schedule: {} },
      { id: "broken", isDefault: false, schedule: { windows: [{ days: "not-an-array" }] } },
    ];
    expect(
      pickActiveMenu(menusWithGarbage, new Date("2026-01-14T12:00:00Z"), "Europe/Berlin")?.id,
    ).toBe("default");
  });
});
