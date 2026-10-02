import { purgeMenuForTenant } from "./cdn-purge";
import {
  localDateTimeToInstant,
  localDayMinutes,
  openState,
  venueDateISO,
  WEEKDAYS,
  type OpeningHours,
} from "./opening-hours";
import { parseOpeningHours } from "./opening-hours-schema";
import { orderingConfigSchema, parseOrderingConfig } from "./ordering-config";
import { asTenant } from "./tenant";

/**
 * "Stop taking orders" (owner, 2026-10-02): the restaurant closes its
 * ordering for a while — 30 minutes, an hour, or the rest of the day —
 * and it reopens BY ITSELF when the time is up, so nobody has to
 * remember to switch it back on.
 *
 * All there is to it is one instant, `ordering.pausedUntil`: ordering is
 * paused while that lies in the future. No job runs at the end; the
 * clock passing it is the reopening. It sits ON TOP of the opening
 * hours — it can close an open restaurant, never open a closed one —
 * and while it holds, every order is refused, planned ones included.
 * Table reservations are a different promise and stay available.
 */

export const PAUSE_CHOICES = ["30", "60", "day"] as const;
export type PauseChoice = (typeof PAUSE_CHOICES)[number];

export function isPauseChoice(v: unknown): v is PauseChoice {
  return typeof v === "string" && (PAUSE_CHOICES as readonly string[]).includes(v);
}

/** The instant ordering is paused until, or null when it is not paused. */
export function activePauseUntil(
  config: { pausedUntil?: string | null },
  now: Date = new Date(),
): Date | null {
  if (!config.pausedUntil) return null;
  const until = new Date(config.pausedUntil);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return null;
  return until;
}

/**
 * When a pause chosen at `now` ends.
 *
 * "Rest of the day" runs to the venue's NEXT OPENING after tonight: the
 * probe sits at 04:00 tomorrow (venue time), when even a late kitchen is
 * shut, and asks the opening hours when the doors open next. A venue
 * with no hours configured, or one that is open around the clock, gets
 * 04:00 tomorrow itself.
 */
export function pauseEnd(
  choice: PauseChoice,
  hours: OpeningHours,
  timezone: string,
  now: Date = new Date(),
): Date {
  if (choice === "30") return new Date(now.getTime() + 30 * 60_000);
  if (choice === "60") return new Date(now.getTime() + 60 * 60_000);

  const tomorrowISO = venueDateISO(timezone, new Date(now.getTime() + 24 * 3600_000));
  const probe =
    localDateTimeToInstant(timezone, tomorrowISO, "04:00") ??
    new Date(now.getTime() + 24 * 3600_000);
  const state = openState(hours, timezone, probe);
  if (!state.configured || state.open || !state.opensDay || !state.opensAt) return probe;

  const probeDay = localDayMinutes(timezone, probe).day;
  const ahead = (WEEKDAYS.indexOf(state.opensDay) - WEEKDAYS.indexOf(probeDay) + 7) % 7;
  const openISO = venueDateISO(timezone, new Date(probe.getTime() + ahead * 24 * 3600_000));
  return localDateTimeToInstant(timezone, openISO, state.opensAt) ?? probe;
}

/**
 * Pause ordering (`choice`) or reopen it now (`"off"`). Returns the new
 * `pausedUntil` (null = taking orders). The rest of the ordering config
 * is round-tripped untouched, and the cached public menu is purged so
 * guests see the change at once.
 */
export async function setOrderingPause(
  tenantId: string,
  choice: PauseChoice | "off",
  now: Date = new Date(),
): Promise<{ ok: true; pausedUntil: Date | null } | { ok: false; error: "not_found" }> {
  const outcome = await asTenant(tenantId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, ordering: true, hours: true, timezone: true },
    });
    if (!venue) return { ok: false as const, error: "not_found" as const };
    const until =
      choice === "off"
        ? null
        : pauseEnd(choice, parseOpeningHours(venue.hours), venue.timezone, now);
    const next = orderingConfigSchema.parse({
      ...parseOrderingConfig(venue.ordering),
      pausedUntil: until ? until.toISOString() : null,
    });
    await tx.venue.update({ where: { id: venue.id }, data: { ordering: next } });
    return { ok: true as const, pausedUntil: until };
  });
  if (outcome.ok) await purgeMenuForTenant(tenantId);
  return outcome;
}
