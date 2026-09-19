import { describe, expect, it } from "vitest";
import {
  localDateTimeToInstant,
  reservableDates,
  slotTimesForDate,
  venueDateISO,
  todaySlotTimes,
  todayLocalTimeToDate,
  compileWeekly,
  formatDay,
  openState,
  type OpeningHours,
} from "./opening-hours";
import { parseOpeningHours } from "./opening-hours-schema";

const TZ = "Europe/Berlin";

// A fixed instant helps: 2026-07-13 is a Monday. All times below are
// UTC; Berlin in July is UTC+2, so add 2h for local wall-clock.
function berlin(dateISO: string): Date {
  return new Date(dateISO);
}

const monSat = compileWeekly({
  slots: [
    { open: "11:00", close: "14:30" },
    { open: "17:30", close: "22:00" },
  ],
  closedDays: ["sun"],
});

describe("compileWeekly", () => {
  it("expands a Mon–Sat + closed-Sunday template to a uniform 7-day shape", () => {
    expect(Object.keys(monSat.days)).toHaveLength(7);
    expect(monSat.days.mon?.slots).toHaveLength(2);
    expect(monSat.days.sun).toEqual({ closed: true, slots: [] });
    expect(monSat.configured).toBe(true);
  });
});

describe("formatDay", () => {
  it("renders split hours and closed days", () => {
    expect(formatDay(monSat.days.mon!)).toBe("11:00–14:30, 17:30–22:00");
    expect(formatDay(monSat.days.sun!)).toBe("Closed");
  });
});

describe("openState", () => {
  it("shows no badge until hours are configured", () => {
    expect(openState(parseOpeningHours({}), TZ)).toEqual({ configured: false });
  });

  it("is open during a lunch slot and reports the closing time", () => {
    // Mon 12:00 Berlin = 10:00 UTC in July.
    const s = openState(monSat, TZ, berlin("2026-07-13T10:00:00Z"));
    expect(s).toEqual({ configured: true, open: true, until: "14:30" });
  });

  it("is closed during the afternoon break and points to the next slot", () => {
    // Mon 15:00 Berlin = 13:00 UTC.
    const s = openState(monSat, TZ, berlin("2026-07-13T13:00:00Z"));
    expect(s).toEqual({ configured: true, open: false, opensDay: "mon", opensAt: "17:30" });
  });

  it("rolls Sunday forward to Monday's first slot", () => {
    // Sun 13:00 Berlin = 11:00 UTC (2026-07-19 is a Sunday).
    const s = openState(monSat, TZ, berlin("2026-07-19T11:00:00Z"));
    expect(s).toEqual({ configured: true, open: false, opensDay: "mon", opensAt: "11:00" });
  });

  it("handles overnight windows spanning midnight", () => {
    const lateBar: OpeningHours = compileWeekly({
      slots: [{ open: "17:00", close: "02:00" }],
      closedDays: [],
    });
    // Fri 23:30 Berlin (21:30 UTC) → open, closes 02:00.
    expect(openState(lateBar, TZ, berlin("2026-07-17T21:30:00Z"))).toMatchObject({
      open: true,
      until: "02:00",
    });
    // Sat 01:00 Berlin (2026-07-17 23:00 UTC) → still open on Friday's tail.
    expect(openState(lateBar, TZ, berlin("2026-07-17T23:00:00Z"))).toMatchObject({
      open: true,
      until: "02:00",
    });
    // Sat 03:00 Berlin (01:00 UTC Sat) → closed, reopens Sat 17:00.
    expect(openState(lateBar, TZ, berlin("2026-07-18T01:00:00Z"))).toMatchObject({
      open: false,
      opensAt: "17:00",
    });
  });

  it("reports permanently-closed when every day is closed", () => {
    const shut = compileWeekly({ slots: [], closedDays: [...([] as never[])] });
    const s = openState(
      { configured: true, days: Object.fromEntries([]) },
      TZ,
      berlin("2026-07-13T10:00:00Z"),
    );
    expect(s).toEqual({ configured: true, open: false, opensDay: null, opensAt: null });
    void shut;
  });
});

describe("todaySlotTimes / todayLocalTimeToDate", () => {
  // Berlin lunch + dinner: 11:00-14:30, 17:30-22:00.
  const hours = compileWeekly({
    slots: [
      { open: "11:00", close: "14:30" },
      { open: "17:30", close: "22:00" },
    ],
    closedDays: [],
  });
  const tz = "Europe/Berlin";
  // 2026-07-17 12:00 Berlin (CEST, UTC+2) = 10:00Z — a Friday.
  const noon = new Date("2026-07-17T10:00:00Z");

  it("offers grid times ≥ 15min from now, skipping the closed gap", () => {
    const slots = todaySlotTimes(hours, tz, noon);
    // 12:00 + 15min buffer → first grid 12:30; lunch ends 14:30 → 12:30…
    // 14:00; then dinner 17:30…21:30.
    expect(slots[0]).toBe("12:30");
    expect(slots).toContain("14:00");
    expect(slots).not.toContain("14:30"); // close boundary excluded
    expect(slots).not.toContain("15:00"); // closed gap
    expect(slots).toContain("17:30");
    expect(slots[slots.length - 1]).toBe("21:30");
  });

  it("carries overnight windows past midnight, in order, and returns [] when unconfigured", () => {
    const night = compileWeekly({ slots: [{ open: "17:00", close: "02:30" }], closedDays: [] });
    // 21:00 Berlin (CEST) = 19:00Z, still a Friday.
    const nine = new Date("2026-07-17T19:00:00Z");
    const slots = todaySlotTimes(night, tz, nine);
    expect(slots[slots.length - 1]).toBe("02:00"); // 02:30 close excluded
    // Post-midnight times sort after the late-evening ones, not before.
    expect(slots.indexOf("23:30")).toBeLessThan(slots.indexOf("00:00"));
    expect(slots.indexOf("00:00")).toBeLessThan(slots.indexOf("02:00"));
    expect(todaySlotTimes({ configured: false } as never, tz, noon)).toEqual([]);
  });

  it("books a post-midnight overnight pick for tomorrow, and validates it as open", () => {
    const night = compileWeekly({ slots: [{ open: "17:00", close: "02:30" }], closedDays: [] });
    const at2200 = new Date("2026-07-17T20:00:00Z"); // 22:00 Berlin, Friday
    const at = todayLocalTimeToDate(tz, "01:00", at2200, night);
    // 22:00 Fri + 3h → 23:00Z = 01:00 Sat Berlin.
    expect(at?.toISOString()).toBe("2026-07-17T23:00:00.000Z");
    const st = openState(night, tz, at!);
    expect(st.configured && st.open).toBe(true);
    // Without an overnight window, the same early time is just past → null.
    const day = compileWeekly({ slots: [{ open: "11:00", close: "22:00" }], closedDays: [] });
    expect(todayLocalTimeToDate(tz, "01:00", at2200, day)).toBeNull();
  });

  it("converts venue-local HH:MM to an absolute timestamp, rejecting the past", () => {
    const at = todayLocalTimeToDate(tz, "18:30", noon);
    expect(at?.toISOString()).toBe("2026-07-17T16:30:00.000Z"); // 18:30 CEST
    expect(todayLocalTimeToDate(tz, "11:00", noon)).toBeNull(); // an hour ago
    expect(todayLocalTimeToDate(tz, "9:00", noon)).toBeNull(); // bad format
  });
});

/* ------------------------------------------------------------------ */
/* Reservation helpers                                                  */
/* ------------------------------------------------------------------ */

describe("slotTimesForDate", () => {
  // 2026-07-13 is a Monday; 2026-07-19 a Sunday (closed in `monSat`).
  const monday = "2026-07-13";
  const sunday = "2026-07-19";
  // 09:00 Berlin — before opening, so the whole day is still offerable.
  const morning = berlin("2026-07-13T07:00:00Z");

  it("offers slots inside each opening window, stopping before closing", () => {
    const slots = slotTimesForDate(monSat, TZ, monday, morning);
    expect(slots[0]).toBe("11:00");
    // Lunch closes 14:30 and the last seating is an hour earlier.
    expect(slots).toContain("13:30");
    expect(slots).not.toContain("14:00");
    expect(slots).toContain("17:30");
    expect(slots.at(-1)).toBe("21:00");
  });

  it("offers nothing on a closed day", () => {
    expect(slotTimesForDate(monSat, TZ, sunday, morning)).toEqual([]);
  });

  it("drops times too close to now on today, keeps the full grid on later days", () => {
    // 12:00 Berlin on the Monday: the 60-minute buffer kills lunch.
    const noon = berlin("2026-07-13T10:00:00Z");
    expect(slotTimesForDate(monSat, TZ, monday, noon)).not.toContain("12:30");
    expect(slotTimesForDate(monSat, TZ, monday, noon)).toContain("17:30");
    // Tomorrow is untouched by today's clock.
    expect(slotTimesForDate(monSat, TZ, "2026-07-14", noon)).toContain("11:00");
  });
});

describe("reservableDates", () => {
  it("lists open days only and skips the closed Sunday", () => {
    const dates = reservableDates(monSat, TZ, berlin("2026-07-13T07:00:00Z"), 7);
    expect(dates.map((d) => d.date)).not.toContain("2026-07-19");
    expect(dates[0]?.date).toBe("2026-07-13");
    expect(dates.every((d) => d.weekday !== "sun")).toBe(true);
  });
});

describe("localDateTimeToInstant", () => {
  it("resolves a venue-local wall clock to the right UTC instant (CEST)", () => {
    const at = localDateTimeToInstant(TZ, "2026-07-13", "19:00");
    // Berlin is UTC+2 in July.
    expect(at?.toISOString()).toBe("2026-07-13T17:00:00.000Z");
    expect(venueDateISO(TZ, at!)).toBe("2026-07-13");
  });

  it("resolves winter time (CET, UTC+1) an hour differently", () => {
    expect(localDateTimeToInstant(TZ, "2026-01-13", "19:00")?.toISOString()).toBe(
      "2026-01-13T18:00:00.000Z",
    );
  });

  it("rejects malformed input", () => {
    expect(localDateTimeToInstant(TZ, "13.07.2026", "19:00")).toBeNull();
    expect(localDateTimeToInstant(TZ, "2026-07-13", "7pm")).toBeNull();
  });
});
