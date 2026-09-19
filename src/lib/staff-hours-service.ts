import { purgeMenuForUser } from "./cdn-purge";
import {
  WEEKDAYS,
  compileWeekly,
  currentOpenState,
  type DayHours,
  type OpeningHours,
  type Slot,
  type Weekday,
} from "./opening-hours";
import { getVenueHours, updateVenueHours } from "./venue-service";

/**
 * Opening hours as the restaurant's own app edits them.
 *
 * ## Why this is not the dashboard's `getVenueHours` re-exported
 *
 * `venues.hours` is deliberately SPARSE on the way in — an unconfigured
 * venue stores `{ configured: false, days: {} }`, and a half-filled map is
 * a legal value that every reader guards. That is right for storage and
 * wrong for a phone: a grid that has to branch on "is Tuesday missing?"
 * before it can draw a row is a grid that will eventually draw six rows.
 * So the wire shape here is TOTAL — always seven days, a missing one
 * answered as `{ closed: true, slots: [] }` — and the sparseness stays a
 * storage detail on this side of the boundary.
 *
 * The write rules are copied from `saveHoursAction` (the dashboard's
 * Settings form) deliberately, not approximated: closed flag wins, at
 * most two `HH:MM`–`HH:MM` slots per day, a day with no usable slot IS
 * closed, and a slot whose close is at or before its open is an OVERNIGHT
 * window (a bar open 17:00–02:00), which `openState` already understands.
 * The one difference is the answer to bad input: a form silently drops a
 * fat-fingered box, an API must say which day it refused, or the app can
 * only show "something was wrong".
 *
 * Both sides then go through `compileWeekly` + `updateVenueHours`, so the
 * owner switching to the dashboard mid-edit never sees two dialects of
 * the same JSONB.
 */

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface StaffHoursDay {
  closed: boolean;
  slots: Slot[];
}

/** Always all seven keys — see the module note. */
export type StaffHoursWeek = Record<Weekday, StaffHoursDay>;

export interface StaffHoursView {
  timezone: string;
  hours: StaffHoursWeek;
  /** Evaluated on OUR clock in the venue's timezone, so a device with a
   *  skewed clock or a traveller's phone still reads the right answer. */
  openNow: boolean;
}

export type StaffHoursResult =
  | { ok: true; value: StaffHoursView }
  | { ok: false; error: "invalid"; field?: string }
  | { ok: false; error: "not_found" };

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

/** Sparse stored map → the total seven-day wire shape. */
export function toStaffHoursWeek(hours: OpeningHours): StaffHoursWeek {
  const out = {} as StaffHoursWeek;
  for (const wd of WEEKDAYS) {
    const day = hours.days[wd];
    out[wd] = day
      ? { closed: day.closed || day.slots.length === 0, slots: day.slots }
      : { closed: true, slots: [] };
  }
  return out;
}

export function toStaffHoursView(timezone: string, hours: OpeningHours): StaffHoursView {
  const state = currentOpenState(hours, timezone);
  return {
    timezone,
    hours: toStaffHoursWeek(hours),
    openNow: state.configured && state.open,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** How many windows one day may carry — the dashboard grid's two boxes
 *  (lunch + dinner), which is also what the app draws. */
const MAX_SLOTS_PER_DAY = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ParsedHours =
  { ok: true; value: Partial<Record<Weekday, DayHours>> } | { ok: false; field?: string };

/**
 * Validate an inbound `hours` map against the dashboard's rules.
 *
 * Pure and export-ed so the wire contract can be tested without a
 * database — the route is then a thin gate around it.
 *
 * An ABSENT day is not an error: the app may PATCH one row of the grid,
 * and a day it never mentions compiles to closed exactly as the form's
 * unchecked boxes do. A PRESENT but malformed day is, and names itself.
 */
export function parseStaffHours(raw: unknown): ParsedHours {
  if (!isRecord(raw)) return { ok: false };

  const perDay: Partial<Record<Weekday, DayHours>> = {};
  for (const wd of WEEKDAYS) {
    const value = raw[wd];
    if (value === undefined || value === null) {
      perDay[wd] = { closed: true, slots: [] };
      continue;
    }
    if (!isRecord(value)) return { ok: false, field: wd };

    if (value.closed !== undefined && typeof value.closed !== "boolean") {
      return { ok: false, field: wd };
    }
    if (value.closed === true) {
      perDay[wd] = { closed: true, slots: [] };
      continue;
    }

    const rawSlots = value.slots === undefined ? [] : value.slots;
    if (!Array.isArray(rawSlots) || rawSlots.length > MAX_SLOTS_PER_DAY) {
      return { ok: false, field: wd };
    }
    const slots: Slot[] = [];
    for (const slot of rawSlots) {
      if (!isRecord(slot)) return { ok: false, field: wd };
      const { open, close } = slot;
      if (typeof open !== "string" || typeof close !== "string") return { ok: false, field: wd };
      if (!TIME_RE.test(open) || !TIME_RE.test(close)) return { ok: false, field: wd };
      // close <= open is NOT an error: that is the overnight window
      // (17:00–02:00), which `openState` reads as crossing midnight.
      slots.push({ open, close });
    }
    // Same rule as the form: a day with no usable window is closed,
    // whatever the flag said.
    perDay[wd] = { closed: slots.length === 0, slots };
  }
  return { ok: true, value: perDay };
}

/* ------------------------------------------------------------------ */
/* Read / write                                                        */
/* ------------------------------------------------------------------ */

export async function getStaffHours(userId: string): Promise<StaffHoursResult> {
  const stored = await getVenueHours(userId);
  if (!stored.ok) return { ok: false, error: "not_found" };
  return { ok: true, value: toStaffHoursView(stored.value.timezone, stored.value.hours) };
}

/**
 * Persist a whole week from the app. `body` is the raw request body, and
 * the `{ hours: … }` envelope is REQUIRED rather than optional: without
 * it an empty `{}` would parse as "no day was mentioned", and every
 * unmentioned day closes — a dropped key would silently shut the
 * restaurant for a week.
 *
 * Purges the CDN on success for the same reason the dashboard action
 * does: the open/closed badge is baked into every cached copy of the
 * public menu, so a saved change nobody can see is not a saved change.
 */
export async function updateStaffHours(userId: string, body: unknown): Promise<StaffHoursResult> {
  if (!isRecord(body) || body.hours === undefined) return { ok: false, error: "invalid" };
  const parsed = parseStaffHours(body.hours);
  if (!parsed.ok) {
    return parsed.field
      ? { ok: false, error: "invalid", field: parsed.field }
      : { ok: false, error: "invalid" };
  }

  const hours = compileWeekly({ slots: [], closedDays: [], perDay: parsed.value });
  const written = await updateVenueHours(userId, hours);
  if (!written.ok) {
    return written.error === "no_venue"
      ? { ok: false, error: "not_found" }
      : { ok: false, error: "invalid" };
  }

  await purgeMenuForUser(userId);

  // Re-read rather than echo: the timezone comes from the row, and a
  // stored-then-reparsed answer is the one the next GET will give.
  return getStaffHours(userId);
}
