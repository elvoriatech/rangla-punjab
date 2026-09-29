import { z } from "zod";
import { asTenant, asUser } from "./tenant";
import { venueDateISO } from "./opening-hours";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * Catering enquiries from the app's "Catering" tile.
 *
 * The same kind of lead as a table reservation — the guest asks, the
 * restaurant calls back and records how it went — with looser rules,
 * because catering is not a table: there is no opening-hours slot grid
 * (the food is cooked for an event, not served at the pass), no party
 * size limit (a family dinner and a wedding are both catering), and the
 * horizon is four months, not sixty days (owner, 2026-09-29).
 *
 * Contact is the one thing that is never optional: a phone number is
 * required, an email may be added, and the guest can say where the event
 * is and what they have in mind.
 */

/** How far ahead a guest may ask, in CALENDAR months (owner: "4 month"). */
export const CATERING_MONTHS_AHEAD = 4;

/**
 * Upper bound on the guest count. Not a business rule — the owner wants
 * no maximum — only a guard against a typo like 80000 landing on the
 * dashboard as if it were real.
 */
export const CATERING_MAX_GUESTS = 5000;

export const cateringSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(5).max(30),
  email: z
    .string()
    .trim()
    .email()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  guests: z.number().int().min(1).max(CATERING_MAX_GUESTS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  location: z.string().trim().max(200).optional(),
  message: z.string().trim().max(1000).optional(),
});

export type CateringInput = z.infer<typeof cateringSchema>;

export const CATERING_STATUSES = ["requested", "confirmed", "declined", "cancelled"] as const;
export type CateringStatus = (typeof CATERING_STATUSES)[number];

export type CreateCateringResult =
  | { ok: true; value: { requestId: string; date: string; status: CateringStatus } }
  | { ok: false; error: "invalid" | "invalid_date" };

/**
 * `YYYY-MM-DD` plus whole calendar months, with the day clamped to the
 * target month's length (31 Oct + 4 months = 28/29 Feb, not 3 March).
 */
export function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  const absolute = y * 12 + (m - 1) + months;
  const ty = Math.floor(absolute / 12);
  const tm = (absolute % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, last);
  return `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

/**
 * The dates a guest may pick, as venue-local calendar dates: from
 * TOMORROW (a caterer cannot cook for tonight off a form) to four months
 * after today, both inclusive. The app draws the same window from the
 * device's clock; this is the authority.
 */
export function cateringWindow(
  timezone: string,
  now = new Date(),
): { first: string; last: string } {
  const today = venueDateISO(timezone, now);
  const first = venueDateISO(timezone, new Date(now.getTime() + 86_400_000));
  return { first, last: addMonthsISO(today, CATERING_MONTHS_AHEAD) };
}

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

export async function createCateringRequest(
  context: { tenantId: string; venueId: string },
  raw: unknown,
  actor?: { customerId?: string | null },
  now = new Date(),
): Promise<CreateCateringResult> {
  const parsed = cateringSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parsed.data;
  if (!isRealDate(input.date)) return { ok: false, error: "invalid_date" };

  return asTenant(context.tenantId, async (tx) => {
    const venue = await tx.venue.findFirstOrThrow({
      where: { id: context.venueId },
      select: { timezone: true },
    });
    // Compared as calendar-date STRINGS, like the reservation horizon:
    // ISO dates sort lexically, and no DST hour can move a boundary.
    const { first, last } = cateringWindow(venue.timezone, now);
    if (input.date < first || input.date > last) {
      return { ok: false as const, error: "invalid_date" as const };
    }

    // Honoured only when the customer really belongs to this tenant —
    // otherwise the enquiry simply stays anonymous (see reservations).
    const customerId = actor?.customerId
      ? ((
          await tx.customer.findFirst({
            where: { id: actor.customerId, deletedAt: null },
            select: { id: true },
          })
        )?.id ?? null)
      : null;

    const row = await tx.cateringRequest.create({
      data: {
        tenantId: context.tenantId,
        venueId: context.venueId,
        customerId,
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        guests: input.guests,
        date: input.date,
        time: input.time || null,
        location: input.location || null,
        message: input.message || null,
      },
      select: { id: true },
    });
    log.info("catering.requested", {
      requestId: row.id,
      venueId: context.venueId,
      guests: input.guests,
      date: input.date,
      signedIn: customerId !== null,
    });
    return {
      ok: true as const,
      value: { requestId: row.id, date: input.date, status: "requested" as const },
    };
  });
}

export interface CateringRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  guests: number;
  date: string;
  time: string | null;
  location: string | null;
  message: string | null;
  status: string;
  createdAt: Date;
}

/**
 * The dashboard's list: every enquiry whose event is today or later
 * (open ones first by event date), plus the last month's closed ones so
 * a "declined" is still findable when the guest calls back.
 */
export async function listCateringRequests(userId: string): Promise<CateringRow[]> {
  const since = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  return asUser(userId, (tx) =>
    tx.cateringRequest.findMany({
      where: { deletedAt: null, date: { gte: since } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 300,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        guests: true,
        date: true,
        time: true,
        location: true,
        message: true,
        status: true,
        createdAt: true,
      },
    }),
  );
}

const SETTABLE = ["confirmed", "declined", "cancelled"] as const;

export async function setCateringStatus(
  userId: string,
  id: string,
  status: string,
): Promise<{ ok: boolean }> {
  if (!(SETTABLE as readonly string[]).includes(status)) return { ok: false };
  return asUser(userId, async (tx) => {
    const existing = await tx.cateringRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return { ok: false };
    await tx.cateringRequest.update({ where: { id }, data: { status } });
    return { ok: true };
  });
}
