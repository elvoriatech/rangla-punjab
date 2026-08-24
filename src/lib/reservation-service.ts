import { z } from "zod";
import { asTenant, asUser } from "./tenant";
import { localDateTimeToInstant, parseOpeningHours, slotTimesForDate } from "./opening-hours";
import { effectiveOrdering, parseOrderingConfig } from "./ordering-config";
import { resolveTenantAccess } from "./plan-state";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * Table reservations from the public menu. The guest picks a date + time
 * that the venue is actually open (the dialog offers only valid slots and
 * this service re-derives them — a forged POST hits the same wall). A
 * reservation starts as `requested`; the restaurant confirms or declines
 * from the dashboard.
 */

export const reservationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(5).max(30),
  guests: z.number().int().min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().trim().max(200).optional(),
});

export type ReservationInput = z.infer<typeof reservationSchema>;

export type CreateReservationResult =
  | { ok: true; value: { reservationId: string; date: string; time: string } }
  | { ok: false; error: "invalid" | "reservations_off" | "invalid_time" };

const MAX_DAYS_AHEAD = 60;

export async function createReservation(
  context: { tenantId: string; venueId: string },
  raw: unknown,
): Promise<CreateReservationResult> {
  const parsed = reservationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;

  return asTenant(context.tenantId, async (tx) => {
    const venue = await tx.venue.findFirstOrThrow({
      where: { id: context.venueId },
      select: { hours: true, timezone: true, ordering: true },
    });
    const tenant = await tx.tenant.findFirstOrThrow({
      select: {
        plan: true,
        entitlementOverrides: true,
        createdAt: true,
        status: true,
        deletedAt: true,
      },
    });
    const subscription = await tx.subscription.findFirst({
      where: { deletedAt: null },
      select: { planCode: true, status: true, trialEnd: true, currentPeriodEnd: true },
    });
    const access = resolveTenantAccess(tenant, subscription);
    const mode = effectiveOrdering(access.entitlements, parseOrderingConfig(venue.ordering));
    if (!mode.reservations) return { ok: false, error: "reservations_off" as const };

    const hours = parseOpeningHours(venue.hours);
    const now = new Date();
    // The offered grid IS the validation: closed days, past times, and
    // times outside opening windows are simply not in it.
    const slots = slotTimesForDate(hours, venue.timezone, input.date, now);
    if (!slots.includes(input.time)) return { ok: false, error: "invalid_time" as const };

    const at = localDateTimeToInstant(venue.timezone, input.date, input.time);
    if (!at || at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
      return { ok: false, error: "invalid_time" as const };
    }

    const reservation = await tx.reservation.create({
      data: {
        tenantId: context.tenantId,
        venueId: context.venueId,
        name: input.name,
        phone: input.phone,
        guests: input.guests,
        at,
        date: input.date,
        time: input.time,
        note: input.note || null,
      },
      select: { id: true },
    });
    log.info("reservation.requested", {
      reservationId: reservation.id,
      venueId: context.venueId,
      guests: input.guests,
      at: at.toISOString(),
    });
    return {
      ok: true as const,
      value: { reservationId: reservation.id, date: input.date, time: input.time },
    };
  });
}

export interface ReservationRow {
  id: string;
  name: string;
  phone: string;
  guests: number;
  at: Date;
  date: string;
  time: string;
  note: string | null;
  status: string;
  createdAt: Date;
}

/** Upcoming (and just-past) reservations for the dashboard, oldest first. */
export async function listReservations(userId: string): Promise<ReservationRow[]> {
  return asUser(userId, (tx) =>
    tx.reservation.findMany({
      where: { deletedAt: null, at: { gte: new Date(Date.now() - 6 * 3_600_000) } },
      orderBy: { at: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        phone: true,
        guests: true,
        at: true,
        date: true,
        time: true,
        note: true,
        status: true,
        createdAt: true,
      },
    }),
  );
}

const SETTABLE = ["confirmed", "declined", "cancelled"] as const;

export async function setReservationStatus(
  userId: string,
  id: string,
  status: string,
): Promise<{ ok: boolean }> {
  if (!(SETTABLE as readonly string[]).includes(status)) return { ok: false };
  return asUser(userId, async (tx) => {
    const existing = await tx.reservation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return { ok: false };
    await tx.reservation.update({
      where: { id },
      data: { status: status as (typeof SETTABLE)[number] },
    });
    return { ok: true };
  });
}
