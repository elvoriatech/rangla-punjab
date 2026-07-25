import { z } from "zod";
import { asUser } from "./tenant";

/**
 * Active-menu resolver. Given a venue's set of menus and a (now, tz) pair,
 * returns the id of the menu that should be shown to a guest right now.
 *
 * Schedule shape (stored in `menus.schedule` JSONB):
 *   { "windows": [ { "days": [1,2,3,4,5], "start": "11:00", "end": "15:00" } ] }
 * Days are Sunday=0 .. Saturday=6 (matches JS Date.getDay()). Times are
 * `HH:mm` in the *venue's* local time; DST is handled by resolving the
 * local wall-clock via `Intl.DateTimeFormat` before the comparison, so a
 * schedule like "17:00-22:00 CET/CEST" stays right on both sides of the
 * spring-forward and fall-back transitions.
 *
 * Precedence when multiple menus match: any non-default match wins over
 * the default. Among non-defaults, the first in the input order wins —
 * callers should sort deterministically (id, or createdAt) if they need
 * stable behaviour across many overlapping schedules.
 */

const timeRe = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const scheduleWindowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  start: z.string().regex(timeRe),
  end: z.string().regex(timeRe),
});

export const scheduleSchema = z.object({
  windows: z.array(scheduleWindowSchema).default([]),
});

export type Schedule = z.infer<typeof scheduleSchema>;

export interface MenuForResolver {
  id: string;
  isDefault: boolean;
  schedule: unknown; // arbitrary JSON — parsed on demand
}

export function pickActiveMenu(
  menus: MenuForResolver[],
  now: Date,
  timeZone: string,
): MenuForResolver | null {
  const { dayOfWeek, minuteOfDay } = localWallClock(now, timeZone);

  const nonDefaultMatch = menus.find(
    (m) => !m.isDefault && scheduleContains(parseScheduleSafe(m.schedule), dayOfWeek, minuteOfDay),
  );
  if (nonDefaultMatch) return nonDefaultMatch;

  return menus.find((m) => m.isDefault) ?? null;
}

/** Reads the tenant's menus for a venue and picks the active one. Used by
 * downstream tasks (P1-10 public rendering); tests exercise `pickActiveMenu`
 * directly with fixture data so this function stays a thin wrapper. */
export async function resolveActiveMenuByVenue(
  userId: string,
  venueId: string,
  now: Date,
  timeZone: string,
): Promise<{ id: string } | null> {
  return asUser(userId, async (tx) => {
    const rows = await tx.menu.findMany({
      where: { venueId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, isDefault: true, schedule: true },
    });
    const active = pickActiveMenu(rows, now, timeZone);
    return active ? { id: active.id } : null;
  });
}

// ---------- helpers ----------

function parseScheduleSafe(raw: unknown): Schedule {
  const parsed = scheduleSchema.safeParse(raw);
  return parsed.success ? parsed.data : { windows: [] };
}

function scheduleContains(schedule: Schedule, dayOfWeek: number, minuteOfDay: number): boolean {
  return schedule.windows.some((w) => {
    const startMin = hhmmToMinutes(w.start);
    const endMin = hhmmToMinutes(w.end);
    if (endMin > startMin) {
      // Normal same-day window.
      return w.days.includes(dayOfWeek) && minuteOfDay >= startMin && minuteOfDay < endMin;
    }
    // Wrap window (e.g. Fri/Sat 22:00–02:00). A shift starting late on a
    // listed day runs through past midnight into the next calendar day —
    // so match the "before midnight" part on the listed day, and the
    // "after midnight" part on the day *following* a listed one.
    const previousDay = (dayOfWeek + 6) % 7;
    return (
      (w.days.includes(dayOfWeek) && minuteOfDay >= startMin) ||
      (w.days.includes(previousDay) && minuteOfDay < endMin)
    );
  });
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Convert a UTC instant into the venue's local `(dayOfWeek, minuteOfDay)`.
 * `Intl.DateTimeFormat` respects the tz's DST rules automatically — the
 * same UTC moment yields `hour=12` in Berlin during summer (CEST, UTC+2)
 * and `hour=13` in winter (CET, UTC+1) if the corresponding local hour
 * is 12 vs 13. Callers just get the local wall clock.
 */
function localWallClock(now: Date, timeZone: string): { dayOfWeek: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10);
  // `en-US` with `hour: "2-digit"` sometimes returns "24" for midnight.
  const hourNormalised = hour === 24 ? 0 : hour;
  const minute = parseInt(get("minute"), 10);
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return { dayOfWeek, minuteOfDay: hourNormalised * 60 + minute };
}
