import { WEEKDAYS, localDayMinutes, type Weekday } from "./opening-hours";

/**
 * OFFER-2 — the ONE pricing authority for restaurant offers ("Angebot").
 *
 * The web menu, the v1 app API and order placement all price an item through
 * this module, so the three surfaces cannot disagree about whether an offer is
 * on. Pure functions of (item fields, venue timezone, an instant): no clock
 * reads, no I/O — the caller injects `now`, tests inject anything.
 *
 * An offer is a reduced FIXED price valid inside an optional DATE RANGE and/or
 * an optional WEEKLY venue-local window; when both are present, both must
 * pass. The weekly window may cross midnight (22:00–01:00), and its `days`
 * refer to the window's START day — Friday 22:00–01:00 runs into Saturday's
 * small hours by design.
 *
 * ## The grace rule — why the edge cache can never over-charge
 *
 * The guest menu is edge-cached for up to 300 s, so a page can show an offer
 * that expired moments ago. Placement therefore honours an offer that was
 * active at ANY instant in the last `OFFER_GRACE_MINUTES`: the guest pays at
 * most what the page showed, and the worst staleness case is the ordinary
 * base price. Checking "active at `now` or at `now − grace`" is sufficient
 * for every window at least as long as the grace: a window that overlaps the
 * interval `(now − grace, now)` without containing either endpoint would have
 * to fit strictly INSIDE it, i.e. be shorter than the grace itself. Windows
 * shorter than 10 minutes are not a merchandising shape anyone has asked for;
 * if one is configured anyway, the failure mode is charging the base price —
 * never more than the page showed.
 */

export const OFFER_GRACE_MINUTES = 10;

/** The four offer fields as they come off an `items` row (Prisma types). */
export interface OfferItemFields {
  priceCents: number;
  offerPriceCents: number | null;
  offerStartsAt: Date | null;
  offerEndsAt: Date | null;
  /** Prisma `Json?` — validated here, never trusted. */
  offerWeekly: unknown;
}

export interface EffectivePrice {
  /** What the guest is charged per unit. */
  unitPriceCents: number;
  /** The regular price the offer reduced from; null when no offer applied. */
  basePriceCents: number | null;
}

interface OfferWeekly {
  days: number[];
  start: string;
  end: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Parse the weekly-window JSON, or null when malformed.
 *
 * `days` are indexes into opening-hours' `WEEKDAYS`: 0 = Monday … 6 = Sunday —
 * the codebase's Monday-first convention, NOT JS `Date#getDay`. A malformed
 * shape makes the OFFER INACTIVE rather than always-on: a broken constraint
 * must narrow the window, because widening it is a price the restaurant never
 * agreed to show.
 */
export function parseOfferWeekly(raw: unknown): OfferWeekly | null {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const w = raw as { days?: unknown; start?: unknown; end?: unknown };
  if (
    !Array.isArray(w.days) ||
    w.days.length === 0 ||
    !w.days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) ||
    typeof w.start !== "string" ||
    typeof w.end !== "string" ||
    !HHMM.test(w.start) ||
    !HHMM.test(w.end)
  ) {
    return null;
  }
  return { days: w.days as number[], start: w.start, end: w.end };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

function weekdayIndex(day: Weekday): number {
  return WEEKDAYS.indexOf(day);
}

/** Is the offer's window (date range ∧ weekly) open at `at`, venue-local? */
export function offerActiveAt(item: OfferItemFields, timezone: string, at: Date): boolean {
  /* Not an offer at all, or not a genuine reduction. The DB CHECK enforces
     offer < base, but this module is also fed by tests and future callers —
     the never-charge-more rule is cheap to restate. */
  if (item.offerPriceCents === null || item.offerPriceCents <= 0) return false;
  if (item.offerPriceCents >= item.priceCents) return false;

  if (item.offerStartsAt && at.getTime() < item.offerStartsAt.getTime()) return false;
  if (item.offerEndsAt && at.getTime() > item.offerEndsAt.getTime()) return false;

  if (item.offerWeekly !== null && item.offerWeekly !== undefined) {
    const weekly = parseOfferWeekly(item.offerWeekly);
    if (!weekly) return false;

    const { day, mins } = localDayMinutes(timezone, at);
    const dayIdx = weekdayIndex(day);
    const prevIdx = (dayIdx + 6) % 7;
    const start = minutesOf(weekly.start);
    const end = minutesOf(weekly.end);

    /* end <= start crosses midnight: Friday 22:00–01:00 is active Friday from
       22:00 AND in Saturday's small hours before 01:00 — `days` name the
       window's START day, so Saturday 00:30 checks membership of Friday. */
    const crosses = end <= start;
    if (!crosses) {
      if (!(weekly.days.includes(dayIdx) && mins >= start && mins < end)) return false;
    } else {
      const inEvening = weekly.days.includes(dayIdx) && mins >= start;
      const inSmallHours = weekly.days.includes(prevIdx) && mins < end;
      if (!inEvening && !inSmallHours) return false;
    }
  }

  return true;
}

/** The price to DISPLAY at `at` — menu page, app API. */
export function effectiveItemPrice(
  item: OfferItemFields,
  timezone: string,
  at: Date,
): EffectivePrice {
  if (offerActiveAt(item, timezone, at)) {
    return { unitPriceCents: item.offerPriceCents!, basePriceCents: item.priceCents };
  }
  return { unitPriceCents: item.priceCents, basePriceCents: null };
}

/**
 * The price to CHARGE at placement: the offer counts if it is active now OR
 * was at any instant within the grace window (see the module header for why
 * two sample points suffice). This is what lets a 300 s-stale cached page
 * never over-charge the guest who ordered from it.
 */
export function effectiveItemPriceWithGrace(
  item: OfferItemFields,
  timezone: string,
  now: Date,
): EffectivePrice {
  const nowPrice = effectiveItemPrice(item, timezone, now);
  if (nowPrice.basePriceCents !== null) return nowPrice;
  const graceInstant = new Date(now.getTime() - OFFER_GRACE_MINUTES * 60_000);
  const gracePrice = effectiveItemPrice(item, timezone, graceInstant);
  if (gracePrice.basePriceCents !== null) return gracePrice;
  return nowPrice;
}
