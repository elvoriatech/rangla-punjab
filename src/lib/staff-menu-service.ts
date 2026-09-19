import { Prisma } from "@prisma/client";
import { z } from "zod";
import { purgeMenuForTenant } from "./cdn-purge";
import { menuImageUrl } from "./menu-images";
import { offerActiveAt, parseOfferWeekly } from "./offer-pricing";
import { orderingConfigSchema, parseOrderingConfig } from "./ordering-config";
import { siteUrl } from "./site-url";
import { asTenant } from "./tenant";

/**
 * The restaurant's own menu controls, as the app shows them: turn a dish
 * off, change its price, put it on offer, switch takeaway/delivery.
 *
 * ## Why this is not just the dashboard's items service
 *
 * The dashboard edits the DRAFT and the owner publishes when the rewrite is
 * finished. Guests read the PUBLISHED version. That split is exactly right for
 * "reprint the menu" and exactly wrong for "we've run out of dal": an owner
 * standing in their own restaurant taps a switch and expects the guest menu to
 * change before the next table orders.
 *
 * So every write here updates the PAIR — the draft row and its published copy —
 * inside one transaction, then purges the CDN. `items.source_item_id` (written
 * by `publishDraft` on every copy) is the link that makes the pair findable;
 * see that migration for how existing menus were back-filled. When no twin can
 * be found the single row is still written and the answer carries
 * `mirrored: false`, so the app can say so rather than pretend.
 *
 * Reads go through `asTenant` (the primary), not `asTenantRead`: the board
 * re-reads straight after a write and a replica lag would show the owner their
 * own tap being undone.
 */

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface StaffOfferWeekly {
  days: number[];
  start: string;
  end: string;
}

export interface StaffItemOffer {
  priceCents: number;
  startsAt: string | null;
  endsAt: string | null;
  weekly: StaffOfferWeekly | null;
}

export interface StaffItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  isAvailable: boolean;
  /** Absolute, like every other v1 image URL. */
  photoUrl: string;
  /** The RAW offer as stored — not the effective price. The app renders the
   *  editor from this, so it must not be collapsed the way the guest menu's
   *  `offer` is. Null when the dish has no offer configured at all. */
  offer: StaffItemOffer | null;
  /** Whether that offer's window is open right now, venue-local. */
  offerActive: boolean;
  /** The draft twin, when this row is a published copy that knows it. */
  sourceItemId: string | null;
}

export interface StaffCategory {
  id: string;
  name: string;
  items: StaffItem[];
}

/** Service result shared by the two writes. `field` names the control the app
 *  should highlight when the refusal is a validation one. */
export type StaffResult<T> =
  { ok: true; value: T } | { ok: false; error: "not_found" | "invalid"; field?: string };

/* ------------------------------------------------------------------ */
/* Reading the published menu                                          */
/* ------------------------------------------------------------------ */

const staffItemSelect = {
  id: true,
  name: true,
  description: true,
  priceCents: true,
  currency: true,
  isAvailable: true,
  offerPriceCents: true,
  offerStartsAt: true,
  offerEndsAt: true,
  offerWeekly: true,
  sourceItemId: true,
  photoMedia: { select: { storageKey: true } },
} satisfies Prisma.ItemSelect;

type StaffItemRow = Prisma.ItemGetPayload<{ select: typeof staffItemSelect }>;

function absolute(path: string): string {
  return path.startsWith("http") ? path : `${siteUrl()}${path}`;
}

function toStaffItem(row: StaffItemRow, timezone: string, now: Date): StaffItem {
  const offer: StaffItemOffer | null =
    row.offerPriceCents === null
      ? null
      : {
          priceCents: row.offerPriceCents,
          startsAt: row.offerStartsAt ? row.offerStartsAt.toISOString() : null,
          endsAt: row.offerEndsAt ? row.offerEndsAt.toISOString() : null,
          // Re-validated on the way out: a hand-edited blob that the pricing
          // module would refuse must not reach the app as if it were live.
          weekly: parseOfferWeekly(row.offerWeekly),
        };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    isAvailable: row.isAvailable,
    photoUrl: absolute(menuImageUrl(row.photoMedia?.storageKey ?? null, row.id, 640)),
    offer,
    offerActive: offerActiveAt(row, timezone, now),
    sourceItemId: row.sourceItemId,
  };
}

/** The venue's timezone — the clock every offer window is read against. */
async function venueTimezone(tx: Prisma.TransactionClient): Promise<string> {
  const venue = await tx.venue.findFirst({
    where: { deletedAt: null },
    select: { timezone: true },
  });
  return venue?.timezone ?? "Europe/Berlin";
}

/**
 * The published menu, in full — including dishes the guest cannot see.
 * "Unavailable" is precisely what the owner opened the screen to change, so
 * filtering it out would hide the switch they came for.
 *
 * A venue that has never published answers with no categories rather than an
 * error: there is nothing to turn off yet, and an error screen would be a
 * worse thing to show a new restaurant than an empty list.
 */
export async function listStaffMenu(tenantId: string): Promise<StaffCategory[]> {
  return asTenant(tenantId, async (tx) => {
    const menu = await tx.menu.findFirst({ select: { publishedVersion: true } });
    if (!menu?.publishedVersion) return [];
    const timezone = await venueTimezone(tx);
    // One instant for the whole menu, so two dishes in one answer can never
    // disagree about whether their shared window is open.
    const now = new Date();

    const categories = await tx.category.findMany({
      where: { menuVersionId: menu.publishedVersion },
      orderBy: { orderIndex: "asc" },
      select: {
        id: true,
        name: true,
        items: {
          where: { deletedAt: null },
          orderBy: { orderIndex: "asc" },
          select: staffItemSelect,
        },
      },
    });

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      items: cat.items.map((item) => toStaffItem(item, timezone, now)),
    }));
  });
}

/* ------------------------------------------------------------------ */
/* Patching one item (both halves of the pair)                         */
/* ------------------------------------------------------------------ */

/** Prices the app may set. The ceiling is the contract's, deliberately far
 *  below the dashboard's €10,000 — a fat finger on a phone is likelier than a
 *  €1,000 dish. */
const MAX_PRICE_CENTS = 100_000;

/** Text limits, deliberately the dashboard's own (`updateItemSchema` in
 *  `items-service.ts`): the same dish can be renamed from either surface, so
 *  a phone must not be able to write a name the dashboard would then refuse
 *  to save back. */
const MAX_NAME_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 2000;

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "not an ISO timestamp" })
  .transform((s) => new Date(s));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const weeklySchema = z.object({
  /** 0 = Monday … 6 = Sunday, the codebase's Monday-first convention. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  start: z.string().regex(HHMM),
  end: z.string().regex(HHMM),
});

const offerSchema = z.object({
  priceCents: z.number().int().min(1).max(MAX_PRICE_CENTS),
  startsAt: isoDate.nullable().optional(),
  endsAt: isoDate.nullable().optional(),
  weekly: weeklySchema.nullable().optional(),
});

/**
 * Every field optional; `offer: null` is the explicit "remove the offer".
 *
 * `name` and `description` are the venue's DEFAULT-locale text — the same
 * columns the dashboard's item form writes. Translation overlay rows
 * (`translation-service.ts`, one row per entity/locale/field) are deliberately
 * left alone, exactly as the dashboard leaves them when the base text changes:
 * a stale translation is a thing the owner can see and fix in the dashboard,
 * whereas silently deleting their Punjabi menu because someone fixed a typo on
 * a phone is not.
 */
export const staffItemPatchSchema = z.object({
  isAvailable: z.boolean().optional(),
  priceCents: z.number().int().min(1).max(MAX_PRICE_CENTS).optional(),
  offer: offerSchema.nullable().optional(),
  name: z.string().trim().min(1).max(MAX_NAME_CHARS).optional(),
  /** Trimmed; blank (or explicit null) clears it, because a description of
   *  spaces renders as an empty paragraph on the guest menu. */
  description: z
    .string()
    .trim()
    .max(MAX_DESCRIPTION_CHARS)
    .nullable()
    .transform((value) => (value === "" ? null : value))
    .optional(),
});

export type StaffItemPatch = z.infer<typeof staffItemPatchSchema>;

/** The first offending path, so the app can point at the right control. */
function offendingField(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue && issue.path.length > 0 ? issue.path.join(".") : "body";
}

export interface StaffItemUpdate {
  item: StaffItem;
  /** True when a twin row was found and written too — i.e. the change is live
   *  for guests AND survives the next publish. */
  mirrored: boolean;
}

/**
 * Every row one staff write must land on, keyed by id with its current
 * price (the one field both callers need for the offer invariant).
 *
 * The pair is resolved from a single anchor: `sourceItemId` on a published
 * row names its draft, and a draft row is its own anchor. From that one id
 * both sides are reachable, so a caller may name EITHER id and get the same
 * write. Null means no such live row in this tenant — which, read under the
 * tenant GUC, is also how another tenant's id answers.
 */
async function resolveItemPair(
  tx: Prisma.TransactionClient,
  itemId: string,
): Promise<Map<string, number> | null> {
  const anchor = await tx.item.findFirst({
    where: { id: itemId, deletedAt: null },
    select: { id: true, sourceItemId: true, priceCents: true },
  });
  if (!anchor) return null;

  const menu = await tx.menu.findFirst({ select: { publishedVersion: true } });
  const draftId = anchor.sourceItemId ?? anchor.id;

  // The draft half: the row `draftId` names, but only if it really lives in
  // a draft version — a dangling link from an older publish must not make
  // some unrelated row a twin.
  const draftTwin = await tx.item.findFirst({
    where: {
      id: draftId,
      deletedAt: null,
      category: { menuVersion: { status: "draft" } },
    },
    select: { id: true, priceCents: true },
  });
  // The published half: every copy of that draft row in the CURRENT
  // published version. Older published versions are history and are left
  // exactly as they were served.
  const publishedTwins = menu?.publishedVersion
    ? await tx.item.findMany({
        where: {
          sourceItemId: draftId,
          deletedAt: null,
          category: { menuVersionId: menu.publishedVersion },
        },
        select: { id: true, priceCents: true },
      })
    : [];

  const rows = new Map<string, number>([[anchor.id, anchor.priceCents]]);
  if (draftTwin) rows.set(draftTwin.id, draftTwin.priceCents);
  for (const row of publishedTwins) rows.set(row.id, row.priceCents);
  return rows;
}

/**
 * Update one dish and its twin.
 *
 * The pair is resolved from a single anchor: `sourceItemId` on a published row
 * names its draft, and a draft row is its own anchor. From that one id both
 * sides are reachable, so the app may patch by EITHER id and get the same
 * write — which matters because the app lists published ids while a future
 * screen may hand back a draft one.
 *
 * Validation is deliberately checked against the pair rather than the row the
 * caller named: a draft whose price the dashboard lowered without publishing
 * would otherwise let an offer through that the DB CHECK refuses on the other
 * half, turning an owner's tap into a 500.
 */
export async function updateStaffItem(
  tenantId: string,
  itemId: string,
  rawPatch: unknown,
): Promise<StaffResult<StaffItemUpdate>> {
  const parsed = staffItemPatchSchema.safeParse(rawPatch ?? {});
  if (!parsed.success) {
    return { ok: false, error: "invalid", field: offendingField(parsed.error) };
  }
  const patch = parsed.data;

  if (
    patch.offer &&
    patch.offer.startsAt &&
    patch.offer.endsAt &&
    patch.offer.endsAt.getTime() <= patch.offer.startsAt.getTime()
  ) {
    return { ok: false, error: "invalid", field: "offer.endsAt" };
  }

  const outcome = await asTenant(tenantId, async (tx): Promise<StaffResult<StaffItemUpdate>> => {
    const rows = await resolveItemPair(tx, itemId);
    if (!rows) return { ok: false, error: "not_found" };

    // An offer must be a genuine reduction on EVERY row it lands on.
    if (patch.offer) {
      const floor =
        patch.priceCents ?? Math.min(...[...rows.values()].map((priceCents) => priceCents));
      if (patch.offer.priceCents >= floor) {
        return { ok: false, error: "invalid", field: "offer.priceCents" };
      }
    } else if (patch.priceCents !== undefined && patch.offer === undefined) {
      // Lowering the price under an offer that stays in place would break the
      // same invariant from the other direction.
      const live = await tx.item.findMany({
        where: { id: { in: [...rows.keys()] }, offerPriceCents: { not: null } },
        select: { offerPriceCents: true },
      });
      if (live.some((row) => (row.offerPriceCents ?? 0) >= patch.priceCents!)) {
        return { ok: false, error: "invalid", field: "priceCents" };
      }
    }

    const data: Prisma.ItemUpdateManyMutationInput = {};
    if (patch.isAvailable !== undefined) data.isAvailable = patch.isAvailable;
    if (patch.priceCents !== undefined) data.priceCents = patch.priceCents;
    // Same both-halves rule as price: rename the published row so guests see
    // it now, and the draft twin so the next publish does not undo it.
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.offer !== undefined) {
      // Prisma needs the DbNull sentinel to write SQL NULL into a Json column.
      data.offerPriceCents = patch.offer?.priceCents ?? null;
      data.offerStartsAt = patch.offer?.startsAt ?? null;
      data.offerEndsAt = patch.offer?.endsAt ?? null;
      data.offerWeekly = patch.offer?.weekly ?? Prisma.DbNull;
    }
    if (Object.keys(data).length > 0) {
      await tx.item.updateMany({ where: { id: { in: [...rows.keys()] } }, data });
    }

    const timezone = await venueTimezone(tx);
    const fresh = await tx.item.findFirstOrThrow({
      where: { id: itemId },
      select: staffItemSelect,
    });
    return {
      ok: true,
      value: {
        item: toStaffItem(fresh, timezone, new Date()),
        mirrored: rows.size > 1,
      },
    };
  });

  // Purge outside the transaction: a CDN hiccup must never roll back a write
  // the owner already saw succeed, and the 300 s s-maxage bounds the damage.
  if (outcome.ok) await purgeMenuForTenant(tenantId);
  return outcome;
}

/* ------------------------------------------------------------------ */
/* The dish photo                                                      */
/* ------------------------------------------------------------------ */

/**
 * The dish's name, or null when this tenant has no such live dish.
 *
 * The photo route asks BEFORE it stores any bytes: a wrong id (or another
 * tenant's, which RLS makes the same thing) must answer 404 without
 * leaving an orphan `Media` row and a file on disk behind it. The name
 * doubles as the upload's alt text, exactly as the dashboard's item form
 * labels the same photo.
 */
export async function findStaffItemName(tenantId: string, itemId: string): Promise<string | null> {
  return asTenant(tenantId, async (tx) => {
    const row = await tx.item.findFirst({
      where: { id: itemId, deletedAt: null },
      select: { name: true },
    });
    return row?.name ?? null;
  });
}

/**
 * Attach a photo to a dish — or, with `null`, take it off.
 *
 * Same both-halves rule as price: the published row so guests see the new
 * picture now, and the draft twin so the next publish does not put the old
 * one back. `photoMediaId` is the same column the dashboard's item form
 * writes, pointing at a `Media` row the caller has already created through
 * `saveUploadedImage` (normalized, EXIF-stripped, stored under the tenant
 * prefix) — this function never touches bytes.
 *
 * Removal DETACHES and keeps the `Media` row, exactly as the dashboard's
 * remove-photo action does (`setCategoryPhoto(..., null)`): the same upload
 * may still be referenced by an older published version, and an owner who
 * clears a photo by accident has not lost the file.
 */
export async function setStaffItemPhoto(
  tenantId: string,
  itemId: string,
  photoMediaId: string | null,
): Promise<StaffResult<StaffItemUpdate>> {
  const outcome = await asTenant(tenantId, async (tx): Promise<StaffResult<StaffItemUpdate>> => {
    const rows = await resolveItemPair(tx, itemId);
    if (!rows) return { ok: false, error: "not_found" };

    if (photoMediaId !== null) {
      // Read back under the tenant GUC, so RLS — not a foreign-key error —
      // is what refuses an upload belonging to somebody else.
      const media = await tx.media.findFirst({
        where: { id: photoMediaId },
        select: { id: true },
      });
      if (!media) return { ok: false, error: "not_found" };
    }

    await tx.item.updateMany({ where: { id: { in: [...rows.keys()] } }, data: { photoMediaId } });

    const timezone = await venueTimezone(tx);
    const fresh = await tx.item.findFirstOrThrow({
      where: { id: itemId },
      select: staffItemSelect,
    });
    return {
      ok: true,
      value: { item: toStaffItem(fresh, timezone, new Date()), mirrored: rows.size > 1 },
    };
  });

  // Outside the transaction, like every other staff write: a CDN hiccup must
  // never roll back a change the owner already saw succeed.
  if (outcome.ok) await purgeMenuForTenant(tenantId);
  return outcome;
}

/* ------------------------------------------------------------------ */
/* Ordering switches                                                   */
/* ------------------------------------------------------------------ */

export interface StaffOrdering {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  /** How long after an order a guest may open a complaint thread, in
   *  whole hours (P7-10). Minimum 1, no ceiling — a restaurant that wants
   *  a week has a reason we do not need to know about. */
  issueWindowHours: number;
  /** Whether the app's board may cancel an order. READ-ONLY here: the
   *  patch schema below deliberately has no such key. */
  appCancelEnabled: boolean;
}

export const staffOrderingPatchSchema = z.object({
  takeaway: z.boolean().optional(),
  delivery: z.boolean().optional(),
  issueWindowHours: z.number().int().min(1).optional(),
});

/**
 * The owner's own switches, NOT the plan-gated effective ones: this is the
 * state of the toggles the app draws, and a toggle must show what the owner
 * set even while the plan happens to suppress it.
 */
export async function getStaffOrdering(tenantId: string): Promise<StaffOrdering> {
  return asTenant(tenantId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { ordering: true },
    });
    const config = parseOrderingConfig(venue?.ordering);
    return {
      dineIn: config.dineIn,
      takeaway: config.takeaway,
      delivery: config.delivery,
      issueWindowHours: config.issueWindowHours,
      appCancelEnabled: config.appCancelEnabled,
    };
  });
}

/**
 * Flip takeaway and/or delivery.
 *
 * The whole config is round-tripped through `orderingConfigSchema`, so
 * delivery areas, notify emails, accepted payments and the reservations switch
 * all survive a toggle — the app only ever sends two booleans and must not be
 * able to erase settings it doesn't know about.
 *
 * `appCancelEnabled` is REPORTED but not settable: an unknown key is
 * stripped by the patch schema, so an app that sends one changes nothing.
 * Letting the app arm its own cancel button would defeat the switch —
 * the owner arms it in the web dashboard.
 */
export async function updateStaffOrdering(
  tenantId: string,
  rawPatch: unknown,
): Promise<StaffResult<StaffOrdering>> {
  const parsed = staffOrderingPatchSchema.safeParse(rawPatch ?? {});
  if (!parsed.success) {
    return { ok: false, error: "invalid", field: offendingField(parsed.error) };
  }

  const outcome = await asTenant(tenantId, async (tx): Promise<StaffResult<StaffOrdering>> => {
    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { id: true, ordering: true },
    });
    if (!venue) return { ok: false, error: "not_found" };

    const current = parseOrderingConfig(venue.ordering);
    const next = orderingConfigSchema.parse({
      ...current,
      ...(parsed.data.takeaway === undefined ? {} : { takeaway: parsed.data.takeaway }),
      ...(parsed.data.delivery === undefined ? {} : { delivery: parsed.data.delivery }),
      ...(parsed.data.issueWindowHours === undefined
        ? {}
        : { issueWindowHours: parsed.data.issueWindowHours }),
    });
    await tx.venue.update({ where: { id: venue.id }, data: { ordering: next } });
    return {
      ok: true,
      value: {
        dineIn: next.dineIn,
        takeaway: next.takeaway,
        delivery: next.delivery,
        issueWindowHours: next.issueWindowHours,
        appCancelEnabled: next.appCancelEnabled,
      },
    };
  });

  if (outcome.ok) await purgeMenuForTenant(tenantId);
  return outcome;
}
