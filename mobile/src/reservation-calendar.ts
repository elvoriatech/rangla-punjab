/**
 * Month grids for the reservation date picker.
 *
 * ⚠ HAND-KEPT COPY of the web app's `src/lib/reservation-calendar.ts`.
 * The RN bundle cannot import from the Next app's `src/`, so the logic
 * lives twice; change both together. The web file is the original and
 * carries the full rationale — the only difference here is that month
 * and weekday NAMES are produced with `toLocaleDateString`, which Hermes
 * supports everywhere, rather than `Intl.DateTimeFormat`.
 *
 * Everything is pure and timezone-free: calendar dates are handled as
 * "YYYY-MM-DD" strings, and the one `Date` handed back is pinned to
 * 12:00 UTC so naming the month can't roll back across the date line.
 */

/** One cell of a month grid. Leading/trailing pad cells have no date. */
export interface CalendarDay {
  date: string | null;
  day: number | null;
  /** True when the venue has at least one free slot that day. */
  available: boolean;
}

export interface CalendarMonth {
  /** "YYYY-MM" — a stable React key. */
  key: string;
  /** The 1st at 12:00 UTC, for `toLocaleDateString(…, {month, year})`. */
  at: Date;
  /** Whole weeks of 7 cells, Monday first. */
  weeks: CalendarDay[][];
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in a Gregorian month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Weekday of a calendar date with MONDAY as 0. */
export function mondayIndex(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" from its parts (`month` 1-12). */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** The seven weekday initials heading the grid, Monday first. 2024-01-01
 *  was a Monday — the dates are never shown, only their names. */
export function weekdayNames(tag: string, weekday: "narrow" | "short" = "narrow"): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const at = new Date(Date.UTC(2024, 0, 1 + i, 12));
    try {
      return at.toLocaleDateString(tag, { weekday, timeZone: "UTC" });
    } catch {
      return at.toLocaleDateString("en-GB", { weekday, timeZone: "UTC" });
    }
  });
}

/** Month + year title for a grid, e.g. "octobre 2026". */
export function monthTitle(at: Date, tag: string): string {
  try {
    return at.toLocaleDateString(tag, { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return at.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }
}

/**
 * Lay the reservable dates over `monthCount` consecutive month grids.
 *
 * `anchorISO` decides which month leads; the app has no venue timezone
 * of its own, so it passes nothing and the earliest offered date leads.
 */
export function reservationMonths(
  available: Iterable<string>,
  anchorISO?: string | null,
  monthCount = 2,
): CalendarMonth[] {
  const open = new Set<string>();
  let earliest: string | null = null;
  for (const d of available) {
    if (!ISO.test(d)) continue;
    open.add(d);
    if (earliest === null || d < earliest) earliest = d;
  }

  const anchor = anchorISO && ISO.test(anchorISO) ? anchorISO : earliest;
  if (!anchor || monthCount < 1) return [];
  const parts = ISO.exec(anchor);
  if (!parts) return [];
  const year = Number(parts[1]);
  const month = Number(parts[2]);

  const months: CalendarMonth[] = [];
  for (let i = 0; i < monthCount; i += 1) {
    // Absolute months, so December → January carries the year for free.
    const absolute = year * 12 + (month - 1) + i;
    const y = Math.floor(absolute / 12);
    const m = (absolute % 12) + 1;
    const total = daysInMonth(y, m);
    const lead = mondayIndex(y, m, 1);

    const cells: CalendarDay[] = [];
    for (let p = 0; p < lead; p += 1) cells.push({ date: null, day: null, available: false });
    for (let d = 1; d <= total; d += 1) {
      const date = isoDate(y, m, d);
      cells.push({ date, day: d, available: open.has(date) });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null, available: false });

    const weeks: CalendarDay[][] = [];
    for (let w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));
    months.push({ key: `${y}-${pad2(m)}`, at: new Date(Date.UTC(y, m - 1, 1, 12)), weeks });
  }
  return months;
}
