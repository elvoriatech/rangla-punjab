import { WEEKDAYS, localDayMinutes } from "./opening-hours";

/**
 * DAYS-1 — the weekdays a dish is on the menu ("Thali Montag" only on
 * Mondays). The web menu, the v1 app API and order placement all ask this
 * module, so the three surfaces cannot disagree about whether a dish is on
 * today. Pure: the caller injects `now`.
 *
 * Days are Monday-first indexes into opening-hours' `WEEKDAYS` (0 = Monday …
 * 6 = Sunday) — the same convention as an offer's weekly window, NOT JS
 * `Date#getDay` — and are read in the VENUE's timezone, so a guest abroad
 * still sees Konstanz's Monday.
 */

export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Short labels for the dashboard's day row and summaries, Monday first. */
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The item's days, cleaned. Anything malformed or empty reads as EVERY day:
 * the DB CHECK already forbids both, and if one slips through anyway the
 * safe failure is a dish that stays on the menu, not one that silently
 * vanishes.
 */
export function normaliseDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...ALL_DAYS];
  const days = [
    ...new Set(raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => a - b);
  return days.length > 0 ? days : [...ALL_DAYS];
}

export function isEveryDay(raw: unknown): boolean {
  return normaliseDays(raw).length === 7;
}

/** Is the dish on the menu on the venue-local day that contains `at`? */
export function availableOnDayAt(raw: unknown, timezone: string, at: Date): boolean {
  const days = normaliseDays(raw);
  if (days.length === 7) return true;
  const { day } = localDayMinutes(timezone, at);
  return days.includes(WEEKDAYS.indexOf(day));
}

/**
 * The days as a short human line for the dashboard: "Mon, Wed, Fri".
 * Every day reads as "Every day" so the list stays quiet for the usual case.
 */
export function formatDays(raw: unknown): string {
  const days = normaliseDays(raw);
  if (days.length === 7) return "Every day";
  return days.map((d) => DAY_SHORT[d]).join(", ");
}

/**
 * Parse the dashboard form's `days` check-boxes. Returns null when none is
 * ticked — the caller refuses that, because "on no day" is what the
 * Available switch is for.
 */
export function daysFromForm(values: FormDataEntryValue[]): number[] | null {
  const days = normaliseDaysStrict(values.map((v) => Number(v)));
  return days.length > 0 ? days : null;
}

function normaliseDaysStrict(raw: number[]): number[] {
  return [...new Set(raw.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
}
