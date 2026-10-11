import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StaffCatering, StaffReservation } from "./staff";

/**
 * Reminders before a booked table or a catering event (owner, 2026-10-11:
 * "ring the bell one hour before a reservation, and one day before a
 * catering, as a popup — and let the restaurant set it").
 *
 * The board already polls both lists, so the reminder is worked out here
 * from what it has: when an upcoming booking enters its lead window it
 * rings the order bell once and shows a popup until someone taps it away.
 * Each reminder fires once per booking and lead — remembered on the device
 * so a restart does not ring it again.
 *
 * The lead times are this device's setting, on the board's ⚙ sheet,
 * beside the sound and the printer.
 */

/** Minutes before a table booking; 0 = off. */
export const TABLE_LEADS = [0, 30, 60, 120] as const;
/** Days before a catering event; 0 = off. */
export const CATERING_LEADS = [0, 1, 2, 3] as const;

export interface ReminderSettings {
  tableMinutes: number;
  cateringDays: number;
}

export const DEFAULT_REMINDERS: ReminderSettings = { tableMinutes: 60, cateringDays: 1 };

const SETTINGS_KEY = "rangla-reminder-settings";
const DONE_KEY = "rangla-reminders-done";

export async function getReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(SETTINGS_KEY)) ?? "null") as unknown;
    if (!raw || typeof raw !== "object") return DEFAULT_REMINDERS;
    const r = raw as Record<string, unknown>;
    const table = Number(r.tableMinutes);
    const days = Number(r.cateringDays);
    return {
      tableMinutes: (TABLE_LEADS as readonly number[]).includes(table)
        ? table
        : DEFAULT_REMINDERS.tableMinutes,
      cateringDays: (CATERING_LEADS as readonly number[]).includes(days)
        ? days
        : DEFAULT_REMINDERS.cateringDays,
    };
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export async function setReminderSettings(next: ReminderSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Honoured for this session even if it cannot be kept.
  }
}

/** Keys of reminders already shown, with when they were shown (ms). */
export async function getDoneReminders(): Promise<Record<string, number>> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(DONE_KEY)) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Keeps the last two weeks only, so the store never grows without end. */
export async function saveDoneReminders(done: Record<string, number>, now: number): Promise<void> {
  const keep: Record<string, number> = {};
  for (const [k, at] of Object.entries(done)) if (now - at < 14 * 86_400_000) keep[k] = at;
  try {
    await AsyncStorage.setItem(DONE_KEY, JSON.stringify(keep));
  } catch {
    // Same as above.
  }
}

export type Reminder =
  | { key: string; kind: "table"; startsAt: number; item: StaffReservation }
  | { key: string; kind: "catering"; startsAt: number; item: StaffCatering };

/** A catering event's start on this device's clock; noon when no time was given. */
export function cateringStart(c: Pick<StaffCatering, "date" | "time">): number {
  const time = c.time && /^\d{2}:\d{2}$/.test(c.time) ? c.time : "12:00";
  return new Date(`${c.date}T${time}:00`).getTime();
}

/** Bookings that still count: asked for or confirmed, not declined or cancelled. */
const live = (status: string): boolean => status === "requested" || status === "confirmed";

/**
 * The reminders due now and not shown yet: the booking starts within its
 * lead and has not started. Pure — the board passes the clock in.
 */
export function dueReminders(
  tables: readonly StaffReservation[],
  catering: readonly StaffCatering[],
  settings: ReminderSettings,
  done: Readonly<Record<string, number>>,
  now: number,
): Reminder[] {
  const out: Reminder[] = [];
  if (settings.tableMinutes > 0) {
    const lead = settings.tableMinutes * 60_000;
    for (const r of tables) {
      const at = new Date(r.at).getTime();
      const key = `t:${r.id}:${settings.tableMinutes}`;
      if (!live(r.status) || done[key] || Number.isNaN(at)) continue;
      if (now >= at - lead && now < at) out.push({ key, kind: "table", startsAt: at, item: r });
    }
  }
  if (settings.cateringDays > 0) {
    const lead = settings.cateringDays * 86_400_000;
    for (const c of catering) {
      const at = cateringStart(c);
      const key = `c:${c.id}:${settings.cateringDays}`;
      if (!live(c.status) || done[key] || Number.isNaN(at)) continue;
      if (now >= at - lead && now < at) out.push({ key, kind: "catering", startsAt: at, item: c });
    }
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}
