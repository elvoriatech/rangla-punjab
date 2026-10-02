import { describe, expect, it } from "vitest";
import { compileWeekly } from "./opening-hours";
import { parseOpeningHours } from "./opening-hours-schema";
import { parseOrderingConfig } from "./ordering-config";
import { activePauseUntil, isPauseChoice, pauseEnd } from "./ordering-pause";

const TZ = "Europe/Berlin";
// Thursday 1 October 2026, 18:10 in Berlin (UTC+2).
const NOW = new Date("2026-10-01T16:10:00.000Z");
const hours = compileWeekly({
  slots: [
    { open: "11:30", close: "14:30" },
    { open: "17:00", close: "22:00" },
  ],
  closedDays: ["sun"],
});

describe("ordering pause", () => {
  it("ends 30 minutes or an hour after it was switched off", () => {
    expect(pauseEnd("30", hours, TZ, NOW)).toEqual(new Date("2026-10-01T16:40:00.000Z"));
    expect(pauseEnd("60", hours, TZ, NOW)).toEqual(new Date("2026-10-01T17:10:00.000Z"));
  });

  it("'rest of the day' runs to the next opening time, skipping a closed day", () => {
    // Thursday evening → Friday 11:30 Berlin.
    expect(pauseEnd("day", hours, TZ, NOW)).toEqual(new Date("2026-10-02T09:30:00.000Z"));
    // Saturday evening → Sunday is closed → Monday 11:30 Berlin.
    const saturday = new Date("2026-10-03T18:00:00.000Z");
    expect(pauseEnd("day", hours, TZ, saturday)).toEqual(new Date("2026-10-05T09:30:00.000Z"));
    // Closed for the day before lunch: still reopens TOMORROW, not this evening.
    const morning = new Date("2026-10-01T08:00:00.000Z");
    expect(pauseEnd("day", hours, TZ, morning)).toEqual(new Date("2026-10-02T09:30:00.000Z"));
  });

  it("falls back to 04:00 tomorrow when no opening hours are configured", () => {
    expect(pauseEnd("day", parseOpeningHours({}), TZ, NOW)).toEqual(
      new Date("2026-10-02T02:00:00.000Z"),
    );
  });

  it("is active only while the stored instant lies ahead — reopening needs no write", () => {
    const config = { pausedUntil: "2026-10-01T16:40:00.000Z" };
    expect(activePauseUntil(config, NOW)).toEqual(new Date("2026-10-01T16:40:00.000Z"));
    expect(activePauseUntil(config, new Date("2026-10-01T16:40:00.000Z"))).toBeNull();
    expect(activePauseUntil({ pausedUntil: null }, NOW)).toBeNull();
    expect(activePauseUntil({ pausedUntil: "nonsense" }, NOW)).toBeNull();
    expect(activePauseUntil({}, NOW)).toBeNull();
  });

  it("stores only a real instant, and knows its three choices", () => {
    expect(parseOrderingConfig({}).pausedUntil).toBeNull();
    expect(parseOrderingConfig({ pausedUntil: "soon" }).pausedUntil).toBeNull();
    expect(parseOrderingConfig({ pausedUntil: "2026-10-01T16:40:00Z" }).pausedUntil).toBe(
      "2026-10-01T16:40:00.000Z",
    );
    expect(["30", "60", "day"].every(isPauseChoice)).toBe(true);
    expect(isPauseChoice("off")).toBe(false);
    expect(isPauseChoice("15")).toBe(false);
  });
});
