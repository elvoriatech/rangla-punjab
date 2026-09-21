/**
 * Per-venue opening hours. Stored in `venues.hours` JSONB.
 *
 * Storage is deliberately UNIFORM: always seven day-entries, each
 * either closed or a list of {open, close} slots in "HH:MM" wall-clock
 * (the venue's own timezone). The three-level settings UI is just an
 * input convenience that COMPILES down to this canonical form — so
 * every reader (open-now badge, future slot generator) reads
 * `hours.days[weekday]` with zero group-expansion logic.
 *
 * Overnight slots are supported: when close <= open the window crosses
 * midnight (a bar open 17:00–02:00), and "open now" checks the previous
 * day's overnight tail too.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/**
 * The canonical shape, as plain TypeScript.
 *
 * P7-16 — these used to be `z.infer<typeof openingHoursSchema>`, which
 * meant every importer of this module (including `reserve-dialog.tsx`, a
 * `"use client"` component on the guest menu) dragged the whole of zod
 * into the browser. The zod schema and `parseOpeningHours` now live in
 * `./opening-hours-schema`, which only server code imports; that file
 * type-asserts the two stay in step, so a schema change still fails the
 * build if it drifts from these.
 */
/* `type`, not `interface`: these values are written straight back into
   the `venues.hours` JSONB column, and only a type alias picks up the
   implicit index signature Prisma's `InputJsonValue` requires. */
export type Slot = {
  /** "HH:MM" wall-clock in the venue's own timezone. */
  open: string;
  close: string;
};

export type DayHours = {
  closed: boolean;
  slots: Slot[];
};

export type OpeningHours = {
  /** true only once the owner has saved hours — an unset venue shows
   *  no badge rather than a misleading "Closed". */
  configured: boolean;
  /** String-keyed (not `Weekday`-keyed) so the record is partial — an
   *  unconfigured or sparse map is valid; readers guard missing days. */
  days: Record<string, DayHours>;
};

function dayFor(hours: OpeningHours, day: Weekday): DayHours {
  return hours.days[day] ?? { closed: true, slots: [] };
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Local weekday + minutes-since-midnight in the venue's timezone. */
/** Venue-local weekday + minutes-since-midnight for an instant — the
 *  offer-pricing module prices weekly windows through this. */
export function localDayMinutes(timezone: string, now: Date): { day: Weekday; mins: number } {
  return localNow(timezone, now);
}

function localNow(timezone: string, now: Date): { day: Weekday; mins: number } {
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
  // Intl can emit "24" for midnight hour in some engines; clamp.
  const h = hh === "24" ? 0 : Number(hh);
  return {
    day: (WEEKDAYS.includes(wd as Weekday) ? wd : "mon") as Weekday,
    mins: h * 60 + Number(mm),
  };
}

function prevDay(day: Weekday): Weekday {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7]!;
}

export type OpenState =
  | { configured: false }
  | { configured: true; open: true; until: string }
  | { configured: true; open: false; opensDay: Weekday; opensAt: string }
  | { configured: true; open: false; opensDay: null; opensAt: null };

/**
 * Is the venue open at `now` (in its timezone)? Returns the closing
 * time when open, or the next opening (day + time) when closed — enough
 * for the public badge. Overnight windows are handled by also checking
 * yesterday's slots whose close crosses midnight.
 */
export function openState(
  hours: OpeningHours,
  timezone: string,
  now: Date = new Date(),
): OpenState {
  if (!hours.configured) return { configured: false };
  const { day, mins } = localNow(timezone, now);

  // Today's normal slots.
  const today = dayFor(hours, day);
  if (!today.closed) {
    for (const slot of today.slots) {
      const o = minutes(slot.open);
      const c = minutes(slot.close);
      const overnight = c <= o;
      if (!overnight && mins >= o && mins < c) {
        return { configured: true, open: true, until: slot.close };
      }
      if (overnight && mins >= o) {
        return { configured: true, open: true, until: slot.close };
      }
    }
  }
  // Yesterday's overnight tail bleeding into the early hours of today.
  const yest = dayFor(hours, prevDay(day));
  if (!yest.closed) {
    for (const slot of yest.slots) {
      const o = minutes(slot.open);
      const c = minutes(slot.close);
      if (c <= o && mins < c) {
        return { configured: true, open: true, until: slot.close };
      }
    }
  }

  // Closed now — find the next opening within the next 7 days.
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const d = WEEKDAYS[(WEEKDAYS.indexOf(day) + ahead) % 7]!;
    const dh = dayFor(hours, d);
    if (dh.closed) continue;
    for (const slot of [...dh.slots].sort((a, b) => minutes(a.open) - minutes(b.open))) {
      if (ahead === 0 && minutes(slot.open) <= mins) continue;
      return { configured: true, open: false, opensDay: d, opensAt: slot.open };
    }
  }
  return { configured: true, open: false, opensDay: null, opensAt: null };
}

/**
 * Selectable fulfilment times for TODAY (venue timezone): "HH:MM"
 * strings on a fixed grid inside today's open windows, starting at
 * least `bufferMins` after `now`. Powers the guest's "When?" picker —
 * ASAP stays the default; these are the "later today" options. The
 * server re-validates the chosen time against the hours, so a stale
 * cached list can annoy but never mis-book.
 */
export function todaySlotTimes(
  hours: OpeningHours,
  timezone: string,
  now: Date,
  stepMins = 30,
  bufferMins = 15,
): string[] {
  if (!hours.configured) return [];
  const { day, mins } = localNow(timezone, now);
  const today = dayFor(hours, day);
  if (today.closed) return [];
  const earliest = mins + bufferMins;
  // Grid minutes measured from today's midnight; an overnight window
  // (close ≤ open) runs past 24*60 so its post-midnight tail (00:00…close)
  // keeps sorting *after* the late-evening times instead of jumping to the
  // top of the list. We format each back to a wall-clock "HH:MM" at the end.
  const grid = new Set<number>();
  for (const slot of today.slots) {
    const o = minutes(slot.open);
    const c = minutes(slot.close) <= o ? minutes(slot.close) + 24 * 60 : minutes(slot.close);
    const firstGrid = Math.ceil(Math.max(o, earliest) / stepMins) * stepMins;
    for (let t = firstGrid; t < c; t += stepMins) grid.add(t);
  }
  return [...grid]
    .sort((a, b) => a - b)
    .map((t) => {
      const tt = t % (24 * 60);
      return `${String(Math.floor(tt / 60)).padStart(2, "0")}:${String(tt % 60).padStart(2, "0")}`;
    });
}

/**
 * Convert a venue-local "HH:MM" for today into an absolute timestamp.
 * Works by offsetting `now` by the minute difference in the venue's
 * clock, so the caller never needs the guest's timezone. Returns null
 * for a time already in the past (small grace for clock skew).
 *
 * Overnight windows: a clock-time earlier than now (e.g. "01:00" picked at
 * 22:00) is treated as the post-midnight tail of today's overnight window
 * and booked for *tomorrow* — but only when `hours` actually has such a
 * window covering it; otherwise it's genuinely past and rejected.
 */
export function todayLocalTimeToDate(
  timezone: string,
  time: string,
  now: Date,
  hours?: OpeningHours,
  graceMins = 10,
): Date | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const target = minutes(time);
  const { day, mins } = localNow(timezone, now);
  // Floor to the minute so the stored timestamp is a clean HH:MM:00
  // rather than inheriting the placement moment's seconds.
  const baseMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  if (target >= mins - graceMins) {
    return new Date(baseMinute + (target - mins) * 60_000);
  }
  // Earlier on the clock than now — valid only as tomorrow's early hours
  // inside today's overnight window.
  if (hours?.configured) {
    const today = dayFor(hours, day);
    const overnight =
      !today.closed &&
      today.slots.some((s) => minutes(s.close) <= minutes(s.open) && target < minutes(s.close));
    if (overnight) return new Date(baseMinute + (target + 24 * 60 - mins) * 60_000);
  }
  return null;
}

/** "11:00–14:30, 17:30–22:00" or "Closed" for one day, for the settings
 *  summary and any public hours table. */
export function formatDay(day: DayHours): string {
  if (day.closed || day.slots.length === 0) return "Closed";
  return day.slots.map((s) => `${s.open}–${s.close}`).join(", ");
}

/**
 * Compile the settings form's simple input into the canonical 7-day
 * shape. `slots` are the shared open windows; `closedDays` are the
 * days that get no slots. Level 3 (per-day override) is expressed by
 * passing an explicit `perDay` map instead.
 */
export function compileWeekly(input: {
  slots: Slot[];
  closedDays: Weekday[];
  perDay?: Partial<Record<Weekday, DayHours>>;
}): OpeningHours {
  const days: Record<string, DayHours> = {};
  // Same-minute slots (e.g. 00:00–00:00) are empty, never "open 24 h" —
  // see the schema. Dropped here too so they are never even stored.
  const real = (slots: Slot[]): Slot[] => slots.filter((s) => s.open !== s.close);
  for (const wd of WEEKDAYS) {
    const given = input.perDay?.[wd];
    if (given) {
      const slots = real(given.slots);
      days[wd] = { closed: given.closed || slots.length === 0, slots: given.closed ? [] : slots };
    } else if (input.closedDays.includes(wd)) {
      days[wd] = { closed: true, slots: [] };
    } else {
      days[wd] = { closed: false, slots: real(input.slots) };
    }
  }
  return { configured: true, days };
}

/** openState at the real current instant — call site for components,
 *  keeping `new Date()` out of render bodies (react purity rule). */
export function currentOpenState(hours: OpeningHours, timezone: string): OpenState {
  return openState(hours, timezone, new Date());
}

/** todaySlotTimes at "now" — module-level so render code stays pure. */
export function currentTodaySlotTimes(hours: OpeningHours, timezone: string): string[] {
  // 15-minute grid: precise enough for pickup/delivery promises without
  // ballooning the dropdown (the old half-hour steps were too coarse).
  return todaySlotTimes(hours, timezone, new Date(), 15);
}

/* ------------------------------------------------------------------ */
/* Reservation helpers — arbitrary-date variants of the "today" slot   */
/* machinery above, shared by the public dialog and the server check.  */
/* ------------------------------------------------------------------ */

/** Venue-local calendar date ("YYYY-MM-DD") of an instant. */
export function venueDateISO(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Weekday key of a calendar date — timezone-independent for pure dates. */
function weekdayOfDate(dateISO: string): Weekday {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return WEEKDAYS[(d.getUTCDay() + 6) % 7]!;
}

/**
 * "HH:MM" grid inside a given DATE's open windows. Today drops times
 * closer than `bufferMins`; the last offered time sits `lastSeatMins`
 * before closing — a table at closing time helps nobody.
 */
export function slotTimesForDate(
  hours: OpeningHours,
  timezone: string,
  dateISO: string,
  now: Date,
  stepMins = 30,
  bufferMins = 60,
  lastSeatMins = 60,
): string[] {
  if (!hours.configured || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return [];
  const dayCfg = dayFor(hours, weekdayOfDate(dateISO));
  if (dayCfg.closed) return [];
  const isToday = venueDateISO(timezone, now) === dateISO;
  const earliest = isToday ? localNow(timezone, now).mins + bufferMins : 0;
  const grid = new Set<number>();
  for (const slot of dayCfg.slots) {
    const o = minutes(slot.open);
    const c = minutes(slot.close) <= o ? minutes(slot.close) + 24 * 60 : minutes(slot.close);
    const first = Math.ceil(Math.max(o, earliest) / stepMins) * stepMins;
    for (let t = first; t <= c - lastSeatMins; t += stepMins) grid.add(t);
  }
  return [...grid]
    .sort((a, b) => a - b)
    .map((t) => {
      const tt = t % (24 * 60);
      return `${String(Math.floor(tt / 60)).padStart(2, "0")}:${String(tt % 60).padStart(2, "0")}`;
    });
}

/**
 * How far ahead a guest may book, in venue-local days counted from today
 * (so index 0 is today and the last offered date is `now + 59 days`).
 *
 * This is the ONE number: `reservableDates` offers exactly this window
 * and `reservation-service.ts` refuses anything past it, so the calendar
 * can never show a day the endpoint would then reject. It used to be 14
 * here against a 60-day server limit, which meant the date picker was a
 * two-week list; the picker is now a two-month calendar (P-B) and offers
 * the whole window.
 */
export const RESERVATION_DAYS_AHEAD = 60;

/** The next `daysAhead` venue-local dates that still have a reservable
 *  slot — closed days and a fully passed today drop out. */
export function reservableDates(
  hours: OpeningHours,
  timezone: string,
  now: Date,
  daysAhead = RESERVATION_DAYS_AHEAD,
): { date: string; weekday: Weekday }[] {
  const out: { date: string; weekday: Weekday }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < daysAhead; i += 1) {
    const date = venueDateISO(timezone, new Date(now.getTime() + i * 86_400_000));
    if (seen.has(date)) continue;
    seen.add(date);
    if (slotTimesForDate(hours, timezone, date, now).length > 0) {
      out.push({ date, weekday: weekdayOfDate(date) });
    }
  }
  return out;
}

/** Minutes the timezone is ahead of UTC at `instant`. */
function tzOffsetMinutes(timezone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Venue-local "YYYY-MM-DD" + "HH:MM" → UTC instant (two-pass for DST). */
export function localDateTimeToInstant(
  timezone: string,
  dateISO: string,
  time: string,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const naive = new Date(`${dateISO}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const pass1 = new Date(naive.getTime() - tzOffsetMinutes(timezone, naive) * 60_000);
  return new Date(naive.getTime() - tzOffsetMinutes(timezone, pass1) * 60_000);
}
