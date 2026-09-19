import { describe, expect, it } from "vitest";
import { compileWeekly, WEEKDAYS, type OpeningHours } from "./opening-hours";
import { parseStaffHours, toStaffHoursView, toStaffHoursWeek } from "./staff-hours-service";

/**
 * The wire contract for the app's opening-hours grid, without a database.
 *
 * Two promises are asserted here because the app codes against both:
 * the READ is total (seven days, always), and the WRITE refuses by NAME
 * (`field: "tue"`) so a phone can highlight the row it rejected instead
 * of saying "something was wrong".
 */
describe("staff-hours-service", () => {
  describe("toStaffHoursWeek", () => {
    it("fills every missing day with closed rather than leaving a hole", () => {
      const sparse: OpeningHours = {
        configured: true,
        days: { mon: { closed: false, slots: [{ open: "11:00", close: "22:00" }] } },
      };
      const week = toStaffHoursWeek(sparse);
      expect(Object.keys(week)).toEqual([...WEEKDAYS]);
      expect(week.mon).toEqual({ closed: false, slots: [{ open: "11:00", close: "22:00" }] });
      expect(week.sun).toEqual({ closed: true, slots: [] });
    });

    it("reports a slot-less open day as closed", () => {
      const week = toStaffHoursWeek({
        configured: true,
        days: { wed: { closed: false, slots: [] } },
      });
      expect(week.wed).toEqual({ closed: true, slots: [] });
    });

    it("answers all-closed for a venue that has never saved hours", () => {
      const week = toStaffHoursWeek({ configured: false, days: {} });
      expect(WEEKDAYS.every((d) => week[d].closed && week[d].slots.length === 0)).toBe(true);
    });
  });

  describe("toStaffHoursView", () => {
    it("computes openNow in the venue's timezone, not the server's", () => {
      // Open every day 00:00–23:59, so the answer cannot depend on when
      // CI happens to run.
      const always = compileWeekly({
        slots: [{ open: "00:00", close: "23:59" }],
        closedDays: [],
      });
      expect(toStaffHoursView("Europe/Berlin", always)).toMatchObject({
        timezone: "Europe/Berlin",
        openNow: true,
      });

      const never = compileWeekly({ slots: [], closedDays: [...WEEKDAYS] });
      expect(toStaffHoursView("Europe/Berlin", never).openNow).toBe(false);
    });

    it("says closed, never open, for an unconfigured venue", () => {
      expect(toStaffHoursView("Europe/Berlin", { configured: false, days: {} }).openNow).toBe(
        false,
      );
    });
  });

  describe("parseStaffHours", () => {
    const week = (over: Record<string, unknown> = {}): Record<string, unknown> =>
      Object.fromEntries(
        WEEKDAYS.map((d) => [
          d,
          over[d] ?? { closed: false, slots: [{ open: "11:00", close: "22:00" }] },
        ]),
      );

    it("accepts a full week and keeps the slots verbatim", () => {
      const parsed = parseStaffHours(week());
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.fri).toEqual({
        closed: false,
        slots: [{ open: "11:00", close: "22:00" }],
      });
    });

    it("treats an absent day as closed instead of refusing the write", () => {
      const parsed = parseStaffHours({
        mon: { closed: false, slots: [{ open: "09:00", close: "17:00" }] },
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.sun).toEqual({ closed: true, slots: [] });
    });

    it("lets closed:true win and drops whatever slots came with it", () => {
      const parsed = parseStaffHours(
        week({ tue: { closed: true, slots: [{ open: "11:00", close: "22:00" }] } }),
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.tue).toEqual({ closed: true, slots: [] });
    });

    it("marks a day with no usable window closed, like the dashboard form", () => {
      const parsed = parseStaffHours(week({ wed: { closed: false, slots: [] } }));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.wed).toEqual({ closed: true, slots: [] });
    });

    it("allows a midnight-crossing window — that is a late bar, not a typo", () => {
      const parsed = parseStaffHours(
        week({ sat: { closed: false, slots: [{ open: "17:00", close: "02:00" }] } }),
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.sat).toEqual({
        closed: false,
        slots: [{ open: "17:00", close: "02:00" }],
      });
    });

    it("accepts the two windows a split day needs and refuses a third", () => {
      const two = [
        { open: "11:00", close: "14:30" },
        { open: "17:30", close: "22:00" },
      ];
      expect(parseStaffHours(week({ thu: { closed: false, slots: two } })).ok).toBe(true);
      expect(
        parseStaffHours(
          week({ thu: { closed: false, slots: [...two, { open: "23:00", close: "23:30" }] } }),
        ),
      ).toEqual({ ok: false, field: "thu" });
    });

    it("names the day it refused, for every shape of bad input", () => {
      const bad: [string, unknown][] = [
        ["25:00", { closed: false, slots: [{ open: "25:00", close: "22:00" }] }],
        ["11:60", { closed: false, slots: [{ open: "11:60", close: "22:00" }] }],
        ["1:00", { closed: false, slots: [{ open: "1:00", close: "22:00" }] }],
        ["missing close", { closed: false, slots: [{ open: "11:00" }] }],
        ["non-string", { closed: false, slots: [{ open: 1100, close: 2200 }] }],
        ["slots not an array", { closed: false, slots: "11:00-22:00" }],
        ["closed not a boolean", { closed: "yes", slots: [] }],
        ["day not an object", "11:00-22:00"],
      ];
      for (const [name, value] of bad) {
        expect(parseStaffHours(week({ tue: value })), name).toEqual({ ok: false, field: "tue" });
      }
    });

    it("refuses a body that is not a map of days, with no field to blame", () => {
      for (const value of [null, undefined, "mon", 7, [{ open: "11:00", close: "22:00" }]]) {
        expect(parseStaffHours(value)).toEqual({ ok: false });
      }
    });

    it("compiles to the same canonical JSONB the dashboard writes", () => {
      const parsed = parseStaffHours(week({ sun: { closed: true } }));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const hours = compileWeekly({ slots: [], closedDays: [], perDay: parsed.value });
      expect(hours.configured).toBe(true);
      expect(Object.keys(hours.days)).toEqual([...WEEKDAYS]);
      expect(hours.days.sun).toEqual({ closed: true, slots: [] });
    });
  });
});
