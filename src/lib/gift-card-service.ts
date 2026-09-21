import type { Prisma } from "@prisma/client";
import { formatGiftCardCode, generateGiftCardCode, normalizeGiftCardCode } from "./gift-card-code";
import {
  isValidGiftCardAmount,
  parseGiftCardConfig,
  type GiftCardConfig,
} from "./gift-card-config";
import { signGiftCardToken } from "./gift-card-token";
import { createLogger } from "./logger";
import { uploadedImageUrl } from "./menu-images";
import { captureException } from "./observability";
import { localDateTimeToInstant, venueDateISO } from "./opening-hours";
import { formatPrice } from "./public-menu";
import { siteUrl } from "./site-url";
import { asTenant } from "./tenant";
import { uiLocale } from "./locales";

/**
 * Gift cards: sell, hold, redeem.
 *
 * Shaped after `loyalty-service.ts` — same tenant-scoping discipline
 * (`tenantId` first, body inside `asTenant`; functions that must join a
 * caller's transaction take `tx` first and never open their own), same
 * lazy expiry on read rather than a cron, same conditional-`updateMany`
 * compare-and-swap for the one-shot claim.
 *
 * The one structural difference is that a gift card is a BEARER
 * instrument. A loyalty voucher belongs to a customer and is addressed by
 * cuid; a gift card is addressed by a code that anyone may hold, which is
 * why `redeemGiftCard` does not take a customer and why the lookup is by
 * code alone.
 *
 * LEGAL: multi-purpose voucher (Mehrzweckgutschein, § 3 Abs. 14 UStG).
 * VAT is due at REDEMPTION, not at sale — the dashboard report keys off
 * `redeemedAt`, and that report exists for the accountant.
 */

const log = createLogger();

/** Statuses a card can still be spent from. */
const LIVE_STATUSES = ["active"] as const;

/**
 * Colliding on a 60-bit code is a ~1e-12 event, but `createMany` would
 * report it as a silent zero-insert, so the mint retries a few times and
 * then gives up loudly rather than handing the guest a card that does not
 * exist.
 */
const CODE_ATTEMPTS = 5;

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

/**
 * The three designs seeded for every venue. German names because the
 * default venue locale is German and the owner renames them anyway —
 * these are a starting point, not copy we maintain in six languages.
 *
 * `imageKey` is a public path (leading slash), which is how
 * `giftCardImageUrl` tells a shipped default from an owner upload.
 */
export const DEFAULT_GIFT_CARD_PRODUCTS = [
  { name: "Kleine Freude", priceCents: 2500, imageKey: "/brand/gift-cards/kleine-freude.png" },
  { name: "Genussabend", priceCents: 5000, imageKey: "/brand/gift-cards/genussabend.png" },
  { name: "Festmahl", priceCents: 10000, imageKey: "/brand/gift-cards/festmahl.png" },
] as const;

export interface GiftCardProductView {
  id: string;
  name: string;
  priceCents: number;
  /** Absolute, for the Expo app, which cannot resolve a bare path
   *  against its own bundle and rebases our origin onto its own. */
  imageUrl: string | null;
  /** The same image, same-origin. The dashboard renders THIS: an owner
   *  looking at their own settings should not need `APP_URL` to be
   *  reachable from their browser for the preview to appear. */
  imagePath: string | null;
  imageKey: string | null;
  active: boolean;
  sortIndex: number;
}

/**
 * An `imageKey` is either a shipped default (a public path, leading
 * slash) or a `media.storageKey` from the owner's upload. Absolute URLs,
 * because the Expo app rebases server origins and cannot resolve a bare
 * path against its own bundle.
 */
export function giftCardImagePath(imageKey: string | null | undefined, width = 640): string | null {
  if (!imageKey) return null;
  return imageKey.startsWith("/") ? imageKey : uploadedImageUrl(imageKey, width);
}

/** The same image as an absolute URL — what API payloads carry. */
export function giftCardImageUrl(imageKey: string | null | undefined, width = 640): string | null {
  const path = giftCardImagePath(imageKey, width);
  return path ? `${siteUrl()}${path}` : null;
}

function productView(p: {
  id: string;
  name: string;
  priceCents: number;
  imageKey: string | null;
  active: boolean;
  sortIndex: number;
}): GiftCardProductView {
  return {
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    imageKey: p.imageKey,
    imageUrl: giftCardImageUrl(p.imageKey),
    imagePath: giftCardImagePath(p.imageKey),
    active: p.active,
    sortIndex: p.sortIndex,
  };
}

/**
 * Make sure the venue's three designs exist, then return them.
 *
 * Seeding is lazy — the first time anyone (owner or guest) asks for the
 * products — rather than a migration backfill, so a venue created
 * tomorrow gets them too. It is safe to race: the partial unique index on
 * (venue_id, sort_index) turns the second caller's insert into a no-op.
 */
export async function ensureGiftCardProducts(
  tx: Prisma.TransactionClient,
  tenantId: string,
  venueId: string,
): Promise<void> {
  await tx.giftCardProduct.createMany({
    data: DEFAULT_GIFT_CARD_PRODUCTS.map((p, i) => ({
      tenantId,
      venueId,
      name: p.name,
      priceCents: p.priceCents,
      imageKey: p.imageKey,
      active: true,
      sortIndex: i,
    })),
    skipDuplicates: true,
  });
}

/** Every design, including inactive ones — the owner's editor. */
export async function listGiftCardProducts(
  tenantId: string,
  venueId: string,
): Promise<GiftCardProductView[]> {
  return asTenant(tenantId, async (tx) => {
    await ensureGiftCardProducts(tx, tenantId, venueId);
    const rows = await tx.giftCardProduct.findMany({
      where: { venueId, deletedAt: null },
      orderBy: { sortIndex: "asc" },
      select: {
        id: true,
        name: true,
        priceCents: true,
        imageKey: true,
        active: true,
        sortIndex: true,
      },
    });
    return rows.map(productView);
  });
}

/** What a guest may buy: active designs, and only when the venue's
 *  master switch is on. */
export async function listActiveGiftCardProducts(
  tenantId: string,
  venueId: string,
  config: GiftCardConfig,
): Promise<GiftCardProductView[]> {
  if (!config.enabled) return [];
  const all = await listGiftCardProducts(tenantId, venueId);
  return all.filter((p) => p.active);
}

/* ------------------------------------------------------------------ */
/* Expiry                                                              */
/* ------------------------------------------------------------------ */

/**
 * When a card paid at `paidAt` dies: 23:59:59 on the same day-of-month,
 * `months` later, in the VENUE's timezone.
 *
 * Unlike a loyalty voucher (which dies at the end of a calendar month),
 * a paid card's term runs from the PAYMENT, because that is the date the
 * buyer's three years are counted from and the date printed on the card.
 *
 * Day-of-month overflow clamps down: paid on 31 August + 6 months is 28
 * (or 29) February, never 3 March. Computed as "midnight on the day
 * after, minus one second" so no month-length table is needed and DST is
 * handled by the same two-pass converter the reservation grid uses.
 */
export function giftCardExpiry(timezone: string, months: number, paidAt: Date): Date {
  const [y, m, d] = venueDateISO(timezone, paidAt).split("-").map(Number);
  const year = y ?? paidAt.getUTCFullYear();
  const month = m ?? 1;
  const day = d ?? 1;

  const shifted = month - 1 + Math.max(0, Math.round(months));
  const targetYear = year + Math.floor(shifted / 12);
  const targetMonth = (shifted % 12) + 1;
  // Day 0 of the NEXT month is the last day of this one.
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTarget);

  // The instant we want is the very end of `targetDay`, so ask for
  // midnight of the day after and step back a second.
  const dayAfter = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay + 1));
  const iso = `${dayAfter.getUTCFullYear()}-${String(dayAfter.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dayAfter.getUTCDate(),
  ).padStart(2, "0")}`;
  const boundary = localDateTimeToInstant(timezone, iso, "00:00");
  return new Date((boundary?.getTime() ?? paidAt.getTime()) - 1000);
}

/**
 * Flip anything past its date to `expired`, lazily, on the way to a read
 * or a redeem. Scoped to one card when an id is given so the redeem path
 * does not scan the venue.
 */
async function expireStaleCards(
  tx: Prisma.TransactionClient,
  where: { id?: string; venueId?: string; purchaserCustomerId?: string },
): Promise<void> {
  await tx.giftCard.updateMany({
    where: { ...where, status: { in: [...LIVE_STATUSES] }, expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export type GiftCardStatus = "pending_payment" | "active" | "redeemed" | "expired" | "refunded";

/** How a redeemed card was spent — the two are mutually exclusive. */
export type GiftCardRedemption =
  | { kind: "counter"; at: string; staffName: string | null; note: string | null }
  | { kind: "order"; at: string; orderNumber: number | null }
  | null;

export interface GiftCardView {
  id: string;
  code: string;
  /** `ABCD-EFGH-JKMN` — what we print and read aloud. */
  codeFormatted: string;
  productName: string | null;
  valueCents: number;
  currency: string;
  status: GiftCardStatus;
  recipientName: string | null;
  message: string | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  sharedAt: string | null;
  redemption: GiftCardRedemption;
  imageUrl: string | null;
  imagePath: string | null;
  /** The link the buyer forwards. Null until the card is paid for. */
  shareUrl: string | null;
}

interface CardRow {
  id: string;
  code: string;
  valueCents: number;
  currency: string;
  status: string;
  recipientName: string | null;
  message: string | null;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  sharedAt: Date | null;
  redeemedAt: Date | null;
  redeemedByUserId: string | null;
  redeemedOrderId: string | null;
  redeemedNote: string | null;
  product: { name: string; imageKey: string | null } | null;
}

/** The public share URL for a card. Unguessable by the HMAC token, which
 *  is what stops someone walking the code space. */
export function giftCardShareUrl(code: string, tenantId: string): string {
  return `${siteUrl()}/gift-cards/${formatGiftCardCode(code)}?t=${signGiftCardToken(code, tenantId)}`;
}

function cardView(
  row: CardRow,
  tenantId: string,
  extra?: { staffName?: string | null; orderNumber?: number | null },
): GiftCardView {
  const redemption: GiftCardRedemption = row.redeemedAt
    ? row.redeemedOrderId
      ? {
          kind: "order",
          at: row.redeemedAt.toISOString(),
          orderNumber: extra?.orderNumber ?? null,
        }
      : {
          kind: "counter",
          at: row.redeemedAt.toISOString(),
          staffName: extra?.staffName ?? null,
          note: row.redeemedNote,
        }
    : null;

  return {
    id: row.id,
    code: row.code,
    codeFormatted: formatGiftCardCode(row.code),
    productName: row.product?.name ?? null,
    valueCents: row.valueCents,
    currency: row.currency,
    status: row.status as GiftCardStatus,
    recipientName: row.recipientName,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    sharedAt: row.sharedAt?.toISOString() ?? null,
    redemption,
    imageUrl: giftCardImageUrl(row.product?.imageKey ?? null),
    imagePath: giftCardImagePath(row.product?.imageKey ?? null),
    // An unpaid card has no link to share — there is nothing to give yet.
    shareUrl: row.paidAt ? giftCardShareUrl(row.code, tenantId) : null,
  };
}

const cardSelect = {
  id: true,
  code: true,
  valueCents: true,
  currency: true,
  status: true,
  recipientName: true,
  message: true,
  createdAt: true,
  paidAt: true,
  expiresAt: true,
  sharedAt: true,
  redeemedAt: true,
  redeemedByUserId: true,
  redeemedOrderId: true,
  redeemedNote: true,
  product: { select: { name: true, imageKey: true } },
} as const;

/* ------------------------------------------------------------------ */
/* Buying                                                              */
/* ------------------------------------------------------------------ */

export type CreateGiftCardResult =
  | { ok: true; card: GiftCardView }
  | { ok: false; error: "disabled" | "unknown_product" | "code_exhausted" | "invalid_amount" };

/**
 * Mint a `pending_payment` card for a guest. The payment is started by
 * the caller (the route) exactly the way an order's is; the card only
 * becomes spendable when the webhook says the money arrived.
 *
 * THE GUEST NAMES THE AMOUNT. The product row is now the DESIGN (its
 * artwork and its name) plus a suggested value; `input.amountCents` is
 * what actually goes on the card. That is a client-supplied price, which
 * would be alarming if it were a price for GOODS — but a gift card is
 * stored value, so "pay €40, get €40 of credit" is self-balancing: the
 * same number is charged and issued, and the charge is built from
 * `valueCents` downstream (`gift-card-payment.ts`), never from anything
 * the client sends a second time. The only real risk is an absurd
 * amount, which is what `GIFT_CARD_AMOUNT` is for — re-checked here, not
 * only at the route, so no other caller can mint a €1,000,000 card.
 */
export async function createGiftCardPurchase(
  tenantId: string,
  venueId: string,
  customerId: string,
  productId: string,
  input: { amountCents: number; recipientName?: string | null; message?: string | null },
): Promise<CreateGiftCardResult> {
  if (!isValidGiftCardAmount(input.amountCents)) {
    return { ok: false as const, error: "invalid_amount" as const };
  }
  return asTenant(tenantId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: { currency: true, giftCards: true },
    });
    if (!venue) return { ok: false as const, error: "disabled" as const };
    if (!parseGiftCardConfig(venue.giftCards).enabled) {
      return { ok: false as const, error: "disabled" as const };
    }

    await ensureGiftCardProducts(tx, tenantId, venueId);
    const product = await tx.giftCardProduct.findFirst({
      where: { id: productId, venueId, deletedAt: null, active: true },
      select: { id: true },
    });
    if (!product) return { ok: false as const, error: "unknown_product" as const };

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = generateGiftCardCode();
      const made = await tx.giftCard.createMany({
        data: [
          {
            tenantId,
            venueId,
            productId: product.id,
            code,
            purchaserCustomerId: customerId,
            recipientName: input.recipientName?.trim() || null,
            message: input.message?.trim() || null,
            // The guest's amount, already bounds-checked above. The
            // product contributes its ARTWORK and its name, not its price.
            valueCents: input.amountCents,
            currency: venue.currency,
            status: "pending_payment",
          },
        ],
        // The code is globally unique; a collision is a lottery win, not
        // an error condition, so retry rather than surface it.
        skipDuplicates: true,
      });
      if (made.count === 0) continue;

      const row = await tx.giftCard.findFirst({ where: { code }, select: cardSelect });
      if (!row) continue;
      return { ok: true as const, card: cardView(row, tenantId) };
    }

    log.error("giftcard.code_exhausted", { tenantId, venueId });
    return { ok: false as const, error: "code_exhausted" as const };
  });
}

/**
 * The money arrived: stamp the payment, start the expiry clock, and let
 * the card be spent.
 *
 * Idempotent by the same conditional-`updateMany` trick the order
 * settlement uses — the Stripe webhook, the PayPal capture and the dev
 * fake-confirm all race for this, and exactly one wins. The loser sees
 * `count === 0` and does nothing, so no guest is emailed twice.
 */
export async function activateGiftCard(
  tenantId: string,
  cardId: string,
  payment: { provider: string; ref: string | null },
): Promise<boolean> {
  const activated = await asTenant(tenantId, async (tx) => {
    const card = await tx.giftCard.findFirst({
      where: { id: cardId },
      select: { id: true, venueId: true, status: true },
    });
    if (!card || card.status !== "pending_payment") return null;

    const venue = await tx.venue.findFirst({
      where: { id: card.venueId },
      select: { timezone: true, giftCards: true },
    });
    const config = parseGiftCardConfig(venue?.giftCards);
    const paidAt = new Date();
    const expiresAt = giftCardExpiry(
      venue?.timezone ?? "Europe/Berlin",
      config.expiryMonths,
      paidAt,
    );

    const won = await tx.giftCard.updateMany({
      where: { id: cardId, status: "pending_payment" },
      data: {
        status: "active",
        paidAt,
        expiresAt,
        paymentProvider: payment.provider,
        paymentRef: payment.ref,
      },
    });
    if (won.count === 0) return null;
    return cardId;
  });

  if (!activated) return false;
  log.info("giftcard.activated", { tenantId, cardId });
  // Outside the transaction, fire-and-forget — an email provider outage
  // must never roll back a paid card.
  void sendGiftCardEmail(tenantId, cardId);
  return true;
}

/** Resolve the card a payment reference belongs to. Used by the PayPal
 *  webhook, which identifies the purchase by its provider order id. */
export async function giftCardIdByPaymentRef(
  tenantId: string,
  ref: string,
): Promise<string | null> {
  return asTenant(tenantId, async (tx) => {
    const row = await tx.giftCard.findFirst({ where: { paymentRef: ref }, select: { id: true } });
    return row?.id ?? null;
  });
}

/** Record the provider's reference before the guest leaves for the
 *  payment sheet, so the return leg can find the card again. */
export async function stampGiftCardPayment(
  tenantId: string,
  cardId: string,
  payment: { provider: string; ref: string },
): Promise<void> {
  await asTenant(tenantId, async (tx) => {
    await tx.giftCard.updateMany({
      where: { id: cardId, status: "pending_payment" },
      data: { paymentProvider: payment.provider, paymentRef: payment.ref },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** The guest's own cards — what they bought, in every state. */
export async function listGiftCardsForCustomer(
  tenantId: string,
  customerId: string,
): Promise<GiftCardView[]> {
  return asTenant(tenantId, async (tx) => {
    await expireStaleCards(tx, { purchaserCustomerId: customerId });
    const rows = await tx.giftCard.findMany({
      where: { purchaserCustomerId: customerId, status: { not: "pending_payment" } },
      orderBy: { createdAt: "desc" },
      select: cardSelect,
    });
    return decorate(tx, tenantId, rows);
  });
}

/**
 * Fill in the two things a card view cannot read off its own row: the
 * order NUMBER it was spent on and the NAME of the staff member who took
 * it at the counter. Both are plain references with no relation to join,
 * so they are fetched in one batch each rather than per card.
 */
async function decorate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rows: CardRow[],
): Promise<GiftCardView[]> {
  const orderIds = [...new Set(rows.map((r) => r.redeemedOrderId).filter((v): v is string => !!v))];
  const userIds = [...new Set(rows.map((r) => r.redeemedByUserId).filter((v): v is string => !!v))];

  const orders = orderIds.length
    ? await tx.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNumber: true },
      })
    : [];
  // `users` is not a tenant table (staff reach a tenant through
  // Membership), so this read is not RLS-filtered — it is narrowed to
  // ids this tenant's own cards already named.
  const users = userIds.length
    ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];

  const orderNumbers = new Map(orders.map((o) => [o.id, o.orderNumber]));
  const staffNames = new Map(users.map((u) => [u.id, u.email]));

  return rows.map((row) =>
    cardView(row, tenantId, {
      orderNumber: row.redeemedOrderId ? (orderNumbers.get(row.redeemedOrderId) ?? null) : null,
      staffName: row.redeemedByUserId ? (staffNames.get(row.redeemedByUserId) ?? null) : null,
    }),
  );
}

/** Look one card up by code — the staff confirm step and the cart's
 *  "type someone else's code" both land here. */
export async function findGiftCardByCode(
  tenantId: string,
  rawCode: string,
): Promise<GiftCardView | null> {
  const code = normalizeGiftCardCode(rawCode);
  if (!code) return null;
  return asTenant(tenantId, async (tx) => {
    // Expire the ONE card we are about to answer about, not the venue's
    // whole book: a lookup is a read, and a read that rewrites every
    // stale row in the tenant is a write nobody asked for.
    const found = await tx.giftCard.findFirst({ where: { code }, select: { id: true } });
    if (!found) return null;
    await expireStaleCards(tx, { id: found.id });
    const row = await tx.giftCard.findFirst({ where: { code }, select: cardSelect });
    if (!row) return null;
    const [view] = await decorate(tx, tenantId, [row]);
    return view ?? null;
  });
}

/**
 * The share page's read. Also records that the link was opened, which is
 * the "shared" step of the timeline — only the FIRST open, so the buyer
 * re-checking their own card does not keep rewriting the date.
 */
export async function openGiftCardShare(
  tenantId: string,
  rawCode: string,
): Promise<GiftCardView | null> {
  const code = normalizeGiftCardCode(rawCode);
  if (!code) return null;
  return asTenant(tenantId, async (tx) => {
    const found = await tx.giftCard.findFirst({ where: { code }, select: { id: true } });
    if (!found) return null;
    await expireStaleCards(tx, { id: found.id });
    const row = await tx.giftCard.findFirst({ where: { code }, select: cardSelect });
    if (!row || row.status === "pending_payment") return null;
    if (!row.sharedAt) {
      await tx.giftCard.updateMany({
        where: { id: row.id, sharedAt: null },
        data: { sharedAt: new Date() },
      });
    }
    const [view] = await decorate(tx, tenantId, [row]);
    return view ?? null;
  });
}

/* ------------------------------------------------------------------ */
/* Redeeming                                                           */
/* ------------------------------------------------------------------ */

/** Every way a redemption can be refused, named so the UI can say which. */
export type RedeemError =
  "unknown" | "not_paid" | "expired" | "already_redeemed" | "refunded" | "wrong_venue";

export type RedeemResult = { ok: true; card: GiftCardView } | { ok: false; error: RedeemError };

/**
 * Turn a card's state into the reason it cannot be spent, or null when it
 * can. Shared by counter redemption and the cart claim so the two can
 * never disagree about what "expired" means.
 */
function refusalFor(
  card: {
    status: string;
    expiresAt: Date | null;
    venueId: string;
  },
  venueId?: string,
): RedeemError | null {
  if (venueId && card.venueId !== venueId) return "wrong_venue";
  if (card.status === "pending_payment") return "not_paid";
  if (card.status === "redeemed") return "already_redeemed";
  if (card.status === "refunded") return "refunded";
  if (card.status === "expired") return "expired";
  // Belt and braces: the lazy expiry pass should have caught this, but a
  // card that ticks over between the pass and here must not be spendable.
  if (card.expiresAt && card.expiresAt.getTime() <= Date.now()) return "expired";
  if (card.status !== "active") return "unknown";
  return null;
}

/**
 * Counter redemption: staff take the card, the whole value is consumed.
 *
 * Single use and full value by decision — there is no residual balance to
 * track, which is what keeps this honest without a ledger. The staff
 * user is recorded because "who took it" is the question the owner asks
 * when the till does not add up.
 */
export async function redeemGiftCardAtCounter(
  tenantId: string,
  rawCode: string,
  staffUserId: string,
  note?: string | null,
): Promise<RedeemResult> {
  const code = normalizeGiftCardCode(rawCode);
  if (!code) return { ok: false, error: "unknown" };

  const outcome = await asTenant(tenantId, async (tx) => {
    const card = await tx.giftCard.findFirst({
      where: { code },
      select: { id: true, status: true, expiresAt: true, venueId: true },
    });
    if (!card) return { ok: false as const, error: "unknown" as const };
    // Flip just this card if its date has passed, so the refusal below
    // reports `expired` off a status that matches what is stored.
    await expireStaleCards(tx, { id: card.id });
    if (card.expiresAt && card.expiresAt.getTime() <= Date.now()) card.status = "expired";

    const refusal = refusalFor(card);
    if (refusal) return { ok: false as const, error: refusal };

    // Compare-and-swap: two tills scanning the same card at once, and
    // exactly one of them gets to take it.
    const won = await tx.giftCard.updateMany({
      where: { id: card.id, status: "active" },
      data: {
        status: "redeemed",
        redeemedAt: new Date(),
        redeemedByUserId: staffUserId,
        redeemedNote: note?.trim() || null,
      },
    });
    if (won.count === 0) return { ok: false as const, error: "already_redeemed" as const };

    const row = await tx.giftCard.findFirst({ where: { id: card.id }, select: cardSelect });
    if (!row) return { ok: false as const, error: "unknown" as const };
    const [view] = await decorate(tx, tenantId, [row]);
    return view
      ? { ok: true as const, card: view }
      : { ok: false as const, error: "unknown" as const };
  });

  if (outcome.ok) {
    log.info("giftcard.redeemed", { tenantId, cardId: outcome.card.id, by: staffUserId });
    void sendGiftCardRedeemedEmail(tenantId, outcome.card.id);
  }
  return outcome;
}

export interface GiftCardClaim {
  giftCardId: string;
  code: string;
  discountCents: number;
}

/**
 * Claim a card inside the caller's order transaction — the cart path.
 *
 * Mirrors `claimArmedVoucher`: joins the caller's `tx`, never opens its
 * own, and returns null rather than throwing when it loses the race, so a
 * contested card costs the guest a discount, not their order.
 *
 * `chargeableCents` caps the discount, because a card cannot pay more
 * than the bill. It is ALSO the reason the cart has to warn about
 * forfeit: the card is single-use, so the difference is lost, and the
 * guest must have agreed to that before we get here.
 */
export async function claimGiftCardForOrder(
  tx: Prisma.TransactionClient,
  rawCode: string,
  venueId: string,
  chargeableCents: number,
): Promise<GiftCardClaim | null> {
  const code = normalizeGiftCardCode(rawCode);
  if (!code) return null;

  // Deliberately NO lazy-expiry sweep here. This runs inside the guest's
  // checkout transaction, under the per-venue advisory lock, so a
  // tenant-wide UPDATE would put every stale card in the venue on the
  // critical path of every order. `refusalFor` compares `expiresAt`
  // directly, so an expired card is refused whatever its stored status
  // says; flipping that status is left to the next read of that card.
  const card = await tx.giftCard.findFirst({
    where: { code },
    select: { id: true, status: true, expiresAt: true, venueId: true, valueCents: true },
  });
  if (!card) return null;
  if (refusalFor(card, venueId)) return null;

  const won = await tx.giftCard.updateMany({
    where: { id: card.id, status: "active" },
    data: { status: "redeemed", redeemedAt: new Date() },
  });
  if (won.count === 0) return null;

  return {
    giftCardId: card.id,
    code,
    discountCents: Math.max(0, Math.min(card.valueCents, chargeableCents)),
  };
}

/** Bind the claimed card to the order that spent it. Separate from the
 *  claim so the order id (assigned mid-transaction) is available. */
export async function attachGiftCardToOrder(
  tx: Prisma.TransactionClient,
  claim: GiftCardClaim,
  orderId: string,
): Promise<void> {
  await tx.giftCard.updateMany({
    where: { id: claim.giftCardId },
    data: { redeemedOrderId: orderId },
  });
}

/**
 * Give the card back when the order it paid for never happened —
 * cancelled before payment, or payment failed.
 *
 * Exactly `restoreOrderVoucher`'s shape: guarded on the card still being
 * the one this order took, and a card whose expiry passed while the order
 * sat open comes back `expired` rather than `active`. That is an ordinary
 * outcome, not an error: the guest lost the race with their own card's
 * clock, and pretending otherwise would let an expired card be spent.
 */
export async function releaseGiftCardFromOrder(tenantId: string, orderId: string): Promise<void> {
  await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { giftCardId: true },
    });
    if (!order?.giftCardId) return;

    const card = await tx.giftCard.findFirst({
      where: { id: order.giftCardId },
      select: { id: true, expiresAt: true },
    });
    if (!card) return;

    const live = !card.expiresAt || card.expiresAt.getTime() > Date.now();
    await tx.giftCard.updateMany({
      where: { id: card.id, status: "redeemed", redeemedOrderId: orderId },
      data: {
        status: live ? "active" : "expired",
        redeemedAt: null,
        redeemedOrderId: null,
      },
    });
    await tx.order.updateMany({
      where: { id: orderId },
      data: { giftCardId: null, giftCardDiscountCents: 0 },
    });
    log.info("giftcard.released", { tenantId, orderId, cardId: card.id, live });
  });
}

/* ------------------------------------------------------------------ */
/* Owner reporting                                                     */
/* ------------------------------------------------------------------ */

export interface GiftCardReportRow extends GiftCardView {
  buyerName: string | null;
  buyerEmail: string | null;
}

export interface GiftCardReport {
  rows: GiftCardReportRow[];
  totals: {
    soldCount: number;
    soldCents: number;
    redeemedCount: number;
    redeemedCents: number;
    /** Money taken that the kitchen still owes food for — the number the
     *  accountant cares about, since VAT falls due at redemption. */
    outstandingCount: number;
    outstandingCents: number;
  };
}

export const GIFT_CARD_STATUS_FILTERS = [
  "all",
  "active",
  "redeemed",
  "expired",
  "refunded",
] as const;
export type GiftCardStatusFilter = (typeof GIFT_CARD_STATUS_FILTERS)[number];

export function isGiftCardStatusFilter(v: string | undefined): v is GiftCardStatusFilter {
  return !!v && (GIFT_CARD_STATUS_FILTERS as readonly string[]).includes(v);
}

/**
 * Every card this venue has sold, with the totals the owner's page and
 * the CSV both show.
 *
 * `pending_payment` rows are excluded throughout: a card the guest
 * abandoned at the payment sheet was never sold, and counting it would
 * inflate both the sold total and the outstanding liability.
 */
export async function getGiftCardReport(
  tenantId: string,
  venueId: string,
  filter: GiftCardStatusFilter = "all",
): Promise<GiftCardReport> {
  return asTenant(tenantId, async (tx) => {
    await expireStaleCards(tx, { venueId });

    const sold = { status: { not: "pending_payment" as const } };
    const rows = await tx.giftCard.findMany({
      where: { venueId, ...sold, ...(filter === "all" ? {} : { status: filter }) },
      orderBy: { paidAt: "desc" },
      select: { ...cardSelect, purchaser: { select: { name: true, email: true } } },
    });

    const all =
      filter === "all"
        ? rows
        : await tx.giftCard.findMany({
            where: { venueId, ...sold },
            select: { status: true, valueCents: true },
          });

    const totals = {
      soldCount: 0,
      soldCents: 0,
      redeemedCount: 0,
      redeemedCents: 0,
      outstandingCount: 0,
      outstandingCents: 0,
    };
    for (const c of all) {
      totals.soldCount += 1;
      totals.soldCents += c.valueCents;
      if (c.status === "redeemed") {
        totals.redeemedCount += 1;
        totals.redeemedCents += c.valueCents;
      } else if (c.status === "active") {
        // Expired and refunded cards are no longer a liability: one the
        // venue will never have to honour, the other already paid back.
        totals.outstandingCount += 1;
        totals.outstandingCents += c.valueCents;
      }
    }

    const views = await decorate(tx, tenantId, rows);
    return {
      rows: views.map((v, i) => ({
        ...v,
        buyerName: rows[i]?.purchaser?.name ?? null,
        buyerEmail: rows[i]?.purchaser?.email ?? null,
      })),
      totals,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Emails                                                              */
/* ------------------------------------------------------------------ */

/**
 * "Here is your gift card" — the buyer's confirmation, carrying the code
 * and the share link they forward.
 *
 * Fire-and-forget and dynamically imported, exactly like the loyalty
 * reward email: JSX must not enter this service's module graph, and a
 * dead SMTP host must not fail a paid purchase.
 */
async function sendGiftCardEmail(tenantId: string, cardId: string): Promise<void> {
  try {
    const data = await giftCardEmailData(tenantId, cardId);
    if (!data) return;
    const { sendEmail } = await import("./email");
    const { GiftCardEmail, giftCardSubject } = await import("@/emails/gift-card-email");
    await sendEmail({
      to: data.email,
      subject: giftCardSubject(data.locale, data.venue.name),
      react: GiftCardEmail({
        venue: data.venue,
        locale: data.locale,
        value: data.value,
        code: data.codeFormatted,
        productName: data.productName,
        recipientName: data.recipientName,
        expires: data.expires,
        shareUrl: data.shareUrl,
      }),
    });
    log.info("giftcard.emailed", { tenantId, cardId });
  } catch (err) {
    captureException(err, { tenantId, cardId, where: "gift-card-email" });
    log.warn("giftcard.email_failed", { tenantId, cardId });
  }
}

/** "Your gift card was redeemed" — a short note to the buyer, so a card
 *  spent by someone else is never a silent surprise. */
async function sendGiftCardRedeemedEmail(tenantId: string, cardId: string): Promise<void> {
  try {
    const data = await giftCardEmailData(tenantId, cardId);
    if (!data) return;
    const { sendEmail } = await import("./email");
    const { GiftCardRedeemedEmail, giftCardRedeemedSubject } =
      await import("@/emails/gift-card-email");
    await sendEmail({
      to: data.email,
      subject: giftCardRedeemedSubject(data.locale, data.venue.name),
      react: GiftCardRedeemedEmail({
        venue: data.venue,
        locale: data.locale,
        value: data.value,
        code: data.codeFormatted,
        redeemedOn: data.redeemedOn,
      }),
    });
    log.info("giftcard.redeemed_emailed", { tenantId, cardId });
  } catch (err) {
    captureException(err, { tenantId, cardId, where: "gift-card-redeemed-email" });
    log.warn("giftcard.redeemed_email_failed", { tenantId, cardId });
  }
}

/** Everything both emails need, pre-formatted — the templates never
 *  format money or dates themselves (see `src/emails/layout.tsx`). */
async function giftCardEmailData(tenantId: string, cardId: string) {
  return asTenant(tenantId, async (tx) => {
    const card = await tx.giftCard.findFirst({
      where: { id: cardId },
      select: {
        code: true,
        valueCents: true,
        currency: true,
        expiresAt: true,
        redeemedAt: true,
        recipientName: true,
        product: { select: { name: true } },
        purchaser: { select: { email: true, locale: true } },
        venue: {
          select: { name: true, timezone: true, defaultLocale: true, branding: true },
        },
      },
    });
    if (!card?.purchaser?.email) return null;

    const locale = uiLocale(card.purchaser.locale ?? card.venue.defaultLocale);
    const branding = (card.venue.branding ?? {}) as Record<string, unknown>;
    const fmtDate = (d: Date | null) =>
      d
        ? new Intl.DateTimeFormat(locale, {
            dateStyle: "long",
            timeZone: card.venue.timezone,
          }).format(d)
        : "";

    return {
      email: card.purchaser.email,
      locale,
      value: formatPrice(card.valueCents, card.currency, locale),
      codeFormatted: formatGiftCardCode(card.code),
      productName: card.product?.name ?? null,
      recipientName: card.recipientName,
      expires: fmtDate(card.expiresAt),
      redeemedOn: fmtDate(card.redeemedAt),
      shareUrl: giftCardShareUrl(card.code, tenantId),
      venue: {
        name: card.venue.name,
        logoKey: typeof branding.logoKey === "string" ? branding.logoKey : null,
        bannerKey: typeof branding.bannerKey === "string" ? branding.bannerKey : null,
        primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : null,
      },
    };
  });
}
