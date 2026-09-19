import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

/**
 * "Are we open right now?", computed on the DEVICE.
 *
 * A faithful port of the server's `openState` (src/lib/opening-hours.ts in
 * the web app) — the same slot semantics, read against the same venue
 * timezone, so the two can only ever disagree about the *instant*, never
 * about the rules:
 *
 *  - the venue-local weekday + minutes-since-midnight come from `Intl`
 *    with the venue's own zone (never the device's), "24" clamped to 0;
 *  - a normal window is `open <= now < close` — the close is EXCLUSIVE;
 *  - a window whose `close <= open` crosses midnight: it is keyed on the
 *    day it STARTS, runs to the end of that day, and its tail is found by
 *    also looking at yesterday (`now < close`);
 *  - "00:00–00:00" is therefore 24 hours, not zero;
 *  - a day that is closed, or missing from the map, contributes nothing;
 *  - hours that were never configured produce NO verdict (`null`) — the
 *    pill hides rather than calling an unconfigured venue shut.
 *
 * Why the app computes this at all, when `venue.openNow` rides on the
 * menu payload: that flag is a snapshot of the moment the payload was
 * built, and an edge copy of it may be up to a minute old. The app used
 * to hold it for the life of the process, so a phone left open across
 * 22:00 still said "Open". The SERVER stays the authority on the hours
 * (and on whether an order may be placed — /api/orders re-checks); the
 * device only supplies the clock, and only when it knows which clock to
 * read (see `venueTimezone`).
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface HoursSlot {
  /** "HH:MM" wall-clock in the venue's own timezone. */
  open: string;
  close: string;
}
export interface DayHours {
  closed: boolean;
  slots: HoursSlot[];
}
export interface VenueHours {
  /** False until the owner has saved hours — no badge, not "Closed". */
  configured: boolean;
  days: Record<string, DayHours>;
}

/**
 * The venue's zone, baked per build (`EXPO_PUBLIC_VENUE_TIMEZONE`,
 * set in eas.json — this is a single-restaurant app).
 *
 * It is the LAST resort: anything the server says in the same breath as
 * the hours wins over it (`/api/v1/staff/hours` sends `timezone`, and
 * the menu payload may grow a `venue.timezone`). Unset is a valid state —
 * then there is no client-side verdict at all and the screens fall back
 * to the server's `openNow`, which is exactly what they did before.
 *
 * The DEVICE's own timezone is deliberately never used: a guest ordering
 * while abroad must not be told the kitchen is shut because their phone
 * is two zones away.
 */
const BUILD_TIMEZONE = (process.env.EXPO_PUBLIC_VENUE_TIMEZONE ?? "").trim() || null;

/** First non-empty zone among the candidates, else the build's own. */
export function venueTimezone(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return BUILD_TIMEZONE;
}

/** "9:05" → 545; anything that is not a time of day → null (the slot is
 *  then dropped, which reads the same as the server's NaN comparisons:
 *  it can never make the venue open). */
function minutesOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return null;
  return (hour % 24) * 60 + minute;
}

function asSlot(raw: unknown): HoursSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (minutesOf(s.open) === null || minutesOf(s.close) === null) return null;
  return { open: String(s.open), close: String(s.close) };
}

function asDayHours(raw: unknown): DayHours {
  if (!raw || typeof raw !== "object") return { closed: true, slots: [] };
  const d = raw as Record<string, unknown>;
  const slots = Array.isArray(d.slots)
    ? d.slots.map(asSlot).filter((s): s is HoursSlot => s !== null)
    : [];
  // A day with no readable window IS closed, whatever the flag says.
  const closed = d.closed === true || slots.length === 0;
  return { closed, slots: closed ? [] : slots };
}

/**
 * Read either shape the app is handed: the menu payload's canonical
 * `{ configured, days: { mon … sun } }`, or the staff route's flat
 * `{ mon … sun }` week (which carries no `configured` flag — a week with
 * a single window in it is configured by definition).
 */
export function asVenueHours(raw: unknown): VenueHours {
  if (!raw || typeof raw !== "object") return { configured: false, days: {} };
  const outer = raw as Record<string, unknown>;
  const source =
    outer.days && typeof outer.days === "object" ? (outer.days as Record<string, unknown>) : outer;
  const days: Record<string, DayHours> = {};
  for (const day of WEEKDAYS) days[day] = asDayHours(source[day]);
  const anySlot = WEEKDAYS.some((day) => days[day]!.slots.length > 0);
  // An explicit flag wins: a venue that configured its hours and then
  // closed every day is SHUT, not unknown.
  const configured = typeof outer.configured === "boolean" ? outer.configured : anySlot;
  return { configured, days };
}

function dayFor(hours: VenueHours, day: Weekday): DayHours {
  return hours.days[day] ?? { closed: true, slots: [] };
}

function prevDay(day: Weekday): Weekday {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7]!;
}

/** Venue-local weekday + minutes since midnight, or null when the zone
 *  is unknown or `Intl` refuses it (an unbuilt ICU, a typo'd zone). */
function localNow(timezone: string, now: Date): { day: Weekday; mins: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const wd =
      parts
        .find((p) => p.type === "weekday")
        ?.value.toLowerCase()
        .slice(0, 3) ?? "mon";
    const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    // Some engines emit "24" for the midnight hour; clamp (server does).
    const h = hh === "24" ? 0 : Number(hh);
    if (!Number.isFinite(h) || !Number.isFinite(Number(mm))) return null;
    return {
      day: (WEEKDAYS.includes(wd as Weekday) ? wd : "mon") as Weekday,
      mins: h * 60 + Number(mm),
    };
  } catch {
    return null;
  }
}

/**
 * Is the venue open at `now`, in its own timezone?
 *
 * `null` means "no verdict here" — hours never configured, or no venue
 * timezone to read them against — and every caller falls back to the
 * server's own `openNow` in that case.
 */
export function openNowFor(
  hours: unknown,
  timezone: string | null | undefined,
  now: Date = new Date(),
): boolean | null {
  if (!timezone) return null;
  const week = asVenueHours(hours);
  if (!week.configured) return null;
  const local = localNow(timezone, now);
  if (!local) return null;
  const { day, mins } = local;

  // Today's windows.
  const today = dayFor(week, day);
  if (!today.closed) {
    for (const slot of today.slots) {
      const o = minutesOf(slot.open)!;
      const c = minutesOf(slot.close)!;
      const overnight = c <= o;
      // Exclusive close; an overnight window runs to the end of the day
      // (and "00:00–00:00" is therefore the whole 24 hours).
      if (!overnight && mins >= o && mins < c) return true;
      if (overnight && mins >= o) return true;
    }
  }
  // Yesterday's overnight tail bleeding into this morning.
  const yesterday = dayFor(week, prevDay(day));
  if (!yesterday.closed) {
    for (const slot of yesterday.slots) {
      const o = minutesOf(slot.open)!;
      const c = minutesOf(slot.close)!;
      if (c <= o && mins < c) return true;
    }
  }
  return false;
}

/** How often the open/closed verdict is recomputed while the app is in
 *  front. Half a minute: the pill should flip within sight of the hour,
 *  and the work is a single `Intl` read. */
const TICK_MS = 30_000;

/**
 * The open/closed verdict, kept live.
 *
 * Recomputes every 30 s and on every return to the foreground (a phone
 * that slept through closing time must not wake up still saying "Open").
 * `fallback` is what the SERVER last said, used until — and whenever —
 * the client has no verdict of its own.
 */
export function useVenueOpenNow(
  hours: unknown,
  timezone: string | null | undefined,
  fallback: boolean | null,
): boolean | null {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const bump = (): void => setTick(Date.now());
    const timer = setInterval(bump, TICK_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") bump();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  return useMemo(
    () => openNowFor(hours, timezone, new Date(tick)) ?? fallback,
    [hours, timezone, tick, fallback],
  );
}
