import type { ReservationStatus } from "@prisma/client";
import { z } from "zod";
import { asTenant, asUser } from "./tenant";
import { localDateTimeToInstant, slotTimesForDate } from "./opening-hours";
import { parseOpeningHours } from "./opening-hours-schema";
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

/** The four values `Reservation.status` can hold. Re-exported from the
 *  Prisma enum so the wire contract and the column can never drift. */
export type ReservationStatusValue = ReservationStatus;
export const RESERVATION_STATUSES = [
  "requested",
  "confirmed",
  "declined",
  "cancelled",
] as const satisfies readonly ReservationStatusValue[];

export type CreateReservationResult =
  | {
      ok: true;
      value: { reservationId: string; date: string; time: string; status: ReservationStatusValue };
    }
  | { ok: false; error: "invalid" | "reservations_off" | "invalid_time" };

const MAX_DAYS_AHEAD = 60;

export async function createReservation(
  context: { tenantId: string; venueId: string },
  raw: unknown,
  /** The signed-in guest, when the request carried a customer token.
   *  Anonymous requests (the common case) pass nothing. */
  actor?: { customerId?: string | null },
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
    const access = resolveTenantAccess(tenant);
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

    // The customer id is only honoured when the row really belongs to this
    // tenant: the caller resolved it from a token, and RLS would reject a
    // foreign one at the FK anyway, but failing softly (anonymous
    // reservation) beats 500ing a guest who is merely signed in elsewhere.
    const customerId = actor?.customerId
      ? ((
          await tx.customer.findFirst({
            where: { id: actor.customerId, deletedAt: null },
            select: { id: true },
          })
        )?.id ?? null)
      : null;

    const reservation = await tx.reservation.create({
      data: {
        tenantId: context.tenantId,
        venueId: context.venueId,
        customerId,
        name: input.name,
        phone: input.phone,
        guests: input.guests,
        at,
        date: input.date,
        time: input.time,
        note: input.note || null,
      },
      select: { id: true, status: true },
    });
    log.info("reservation.requested", {
      reservationId: reservation.id,
      venueId: context.venueId,
      guests: input.guests,
      at: at.toISOString(),
      signedIn: customerId !== null,
    });
    return {
      ok: true as const,
      value: {
        reservationId: reservation.id,
        date: input.date,
        time: input.time,
        status: reservation.status,
      },
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

/* ------------------------------------------------------------------ */
/* Guest-side reads — "what happened to my table request?"             */
/* ------------------------------------------------------------------ */

/**
 * The reservation as the guest sees it: their own request plus whatever
 * the restaurant decided. Deliberately narrower than {@link ReservationRow}
 * — no phone number echoed back, no `at` instant (the wall-clock pair the
 * guest actually picked is the honest thing to show), and the venue block
 * carries only what a guest needs to chase it up.
 *
 * Clients MUST tolerate a `status` they don't recognize — same contract
 * rule as the order tracker: the lifecycle may grow after an app ships.
 */
export interface ReservationView {
  id: string;
  /** Venue-local wall clock the guest picked — "YYYY-MM-DD" / "HH:MM". */
  date: string;
  time: string;
  guests: number;
  name: string;
  status: ReservationStatusValue;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  venue: { name: string; phone: string | null };
}

const VIEW_SELECT = {
  id: true,
  date: true,
  time: true,
  guests: true,
  name: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  venue: { select: { name: true } },
} as const;

interface ViewRow {
  id: string;
  date: string;
  time: string;
  guests: number;
  name: string;
  status: ReservationStatusValue;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  venue: { name: string };
}

/**
 * `phone` is in the contract from day one because "call the restaurant"
 * is the obvious next step from a `declined` badge — but `Venue` has no
 * phone column yet, so it is honestly `null` rather than invented. When
 * the column lands this is the one line that changes.
 */
function toReservationView(row: ViewRow): ReservationView {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    guests: row.guests,
    name: row.name,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    venue: { name: row.venue.name, phone: null },
  };
}

/**
 * One reservation, for a caller that already proved it may read it (a
 * signed reservation token). Soft-deleted rows read as gone.
 */
export async function getReservationForGuest(
  tenantId: string,
  reservationId: string,
): Promise<ReservationView | null> {
  const row = await asTenant(tenantId, (tx) =>
    tx.reservation.findFirst({
      where: { id: reservationId, deletedAt: null },
      select: VIEW_SELECT,
    }),
  );
  return row ? toReservationView(row) : null;
}

/** How many reservations one guest's history returns. */
const GUEST_HISTORY_LIMIT = 50;

/** The signed-in guest's own reservations, newest request first. */
export async function listCustomerReservations(
  tenantId: string,
  customerId: string,
): Promise<ReservationView[]> {
  const rows = await asTenant(tenantId, (tx) =>
    tx.reservation.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: GUEST_HISTORY_LIMIT,
      select: VIEW_SELECT,
    }),
  );
  return rows.map(toReservationView);
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
