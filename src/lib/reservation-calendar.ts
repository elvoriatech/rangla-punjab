/**
 * Month grids for the table-reservation date picker.
 *
 * The reservable window is a flat list of "YYYY-MM-DD" strings — every
 * day the venue is open and still has a free slot (`reservableDates`).
 * A guest picking a table two weeks out should not scroll a 60-entry
 * dropdown, so both the web dialog and the RN sheet lay that list over a
 * normal calendar: the current month and the next one, Monday first,
 * days without a slot greyed out.
 *
 * Everything here is PURE and timezone-free: it only ever manipulates
 * calendar dates as "YYYY-MM-DD" strings, and the one `Date` it hands
 * back is pinned to 12:00 UTC purely so `Intl.DateTimeFormat` can name
 * the month without a midnight rollover flipping it in UTC-n zones.
 *
 * ⚠ `mobile/src/reservation-calendar.ts` is a hand-kept copy — the RN
 * bundle cannot import from this app's `src/`. Change both together.
 */

/** One cell of a month grid. Leading/trailing pad cells have no date. */
export interface CalendarDay {
  /** "YYYY-MM-DD", or null for a pad cell before the 1st / after the last. */
  date: string | null;
  /** Day of the month, or null for a pad cell. */
  day: number | null;
  /** True when the venue has at least one free slot that day. */
  available: boolean;
}

export interface CalendarMonth {
  /** "YYYY-MM" — a stable React key. */
  key: string;
  /** The 1st at 12:00 UTC, for `Intl.DateTimeFormat(…, {month, year})`. */
  at: Date;
  /** Whole weeks of 7 cells, Monday first. */
  weeks: CalendarDay[][];
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in a Gregorian month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Weekday of a calendar date with MONDAY as 0 — the week start every
 *  locale this app ships uses (de/fr/es/it/ar; en-GB, not en-US). */
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

/**
 * The seven weekday names to head the grid, Monday first, in `locale`.
 * `width` follows `Intl`'s own vocabulary: "narrow" is the single letter
 * the compact phone grid uses, "short" the three-letter desktop form.
 *
 * 2024-01-01 was a Monday, which is all the anchor has to be: the dates
 * are never shown, only their weekday names.
 */
export function weekdayNames(locale: string, width: "narrow" | "short" = "narrow"): string[] {
  const fmt = safeFormat(locale, { weekday: width, timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i, 12))));
}

/** `Intl.DateTimeFormat` that degrades to English rather than throwing on
 *  a locale tag the runtime does not know. */
export function safeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale || "en", options);
  } catch {
    return new Intl.DateTimeFormat("en", options);
  }
}

/**
 * Lay the reservable dates over `monthCount` consecutive month grids.
 *
 * `anchorISO` decides which month comes first — the venue's local today
 * on the web, the earliest offered date in the app (which has no
 * timezone of its own). An anchor with no reservable date after it still
 * produces grids, all cells disabled, rather than an empty dialog.
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
    // Month arithmetic in absolute months, so December → January carries
    // the year without a special case.
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
