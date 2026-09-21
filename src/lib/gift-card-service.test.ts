import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import { signInCustomer } from "./customer-auth";
import { prisma } from "./db";
import { generateGiftCardCode, normalizeGiftCardCode } from "./gift-card-code";
import {
  DEFAULT_GIFT_CARD_PRODUCTS,
  activateGiftCard,
  claimGiftCardForOrder,
  createGiftCardPurchase,
  findGiftCardByCode,
  giftCardExpiry,
  listActiveGiftCardProducts,
  listGiftCardProducts,
  redeemGiftCardAtCounter,
  type GiftCardView,
} from "./gift-card-service";
import { GIFT_CARD_AMOUNT, parseGiftCardConfig } from "./gift-card-config";
import { asTenant } from "./tenant";

/**
 * Gift cards against a real database, for the same reason
 * `loyalty-service.test.ts` is: the claims worth proving are database
 * claims. A card is a BEARER instrument and single use, so "exactly one
 * redemption ever wins" is not a nicety — it is the whole product. Two
 * tills scanning the same card at the same moment is the case that has
 * to hold, and no in-memory fake can prove it.
 *
 * Expiry is pure arithmetic and is tested without a database at the top.
 */

const tenantIds: string[] = [];
const userIds: string[] = [];

interface Fixture {
  tenantId: string;
  venueId: string;
  customerId: string;
  staffUserId: string;
}

/** A venue with the three seeded designs and one signed-in buyer. */
async function fixture(
  giftCards: Prisma.InputJsonObject = {},
  timezone = "Europe/Berlin",
): Promise<Fixture> {
  const s = await signupUser({
    email: `giftcard-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Gift Card Test",
  });
  if (!s.ok) throw new Error("signup failed");
  userIds.push(s.userId);
  tenantIds.push(s.tenantId);

  return asTenant(s.tenantId, async (tx) => {
    const venue = await tx.venue.create({
      data: {
        tenantId: s.tenantId,
        name: "Rangla Punjab",
        slug: `gc-${randomUUID().slice(0, 8)}`,
        currency: "EUR",
        timezone,
        giftCards,
      },
      select: { id: true },
    });
    const signedIn = await signInCustomer(s.tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    return {
      tenantId: s.tenantId,
      venueId: venue.id,
      customerId: signedIn.customerId,
      staffUserId: s.userId,
    };
  });
}

/** A second venue under the same tenant — the "wrong venue" case needs a
 *  card that is perfectly valid, just not here. */
async function secondVenue(fx: Fixture): Promise<string> {
  return asTenant(fx.tenantId, async (tx) => {
    const venue = await tx.venue.create({
      data: {
        tenantId: fx.tenantId,
        name: "Rangla Punjab Nord",
        slug: `gc2-${randomUUID().slice(0, 8)}`,
        currency: "EUR",
        timezone: "Europe/Berlin",
      },
      select: { id: true },
    });
    return venue.id;
  });
}

/** The product at `index` of the venue's three seeded designs. */
async function productAt(fx: Fixture, index = 0, venueId = fx.venueId) {
  const products = await listGiftCardProducts(fx.tenantId, venueId);
  const product = products[index];
  if (!product) throw new Error(`no product at index ${index}`);
  return product;
}

/**
 * Buy a card and leave it `pending_payment`, the way the route does.
 *
 * `amountCents` defaults to the design's SUGGESTED price only so the
 * tests that are about something else (activation, redemption, expiry)
 * stay readable — the route has no such default, and the tests below
 * that are about the amount pass it explicitly.
 */
async function buy(
  fx: Fixture,
  index = 0,
  venueId = fx.venueId,
  amountCents?: number,
): Promise<GiftCardView> {
  const product = await productAt(fx, index, venueId);
  const created = await createGiftCardPurchase(fx.tenantId, venueId, fx.customerId, product.id, {
    phone: "07531 123456",
    amountCents: amountCents ?? product.priceCents,
    recipientName: "Simran",
    message: "Happy birthday",
  });
  if (!created.ok) throw new Error(`purchase refused: ${created.error}`);
  return created.card;
}

/** Buy a card and settle it, the way the webhook does. */
async function activeCard(fx: Fixture, index = 0, venueId = fx.venueId): Promise<GiftCardView> {
  const card = await buy(fx, index, venueId);
  expect(await activateGiftCard(fx.tenantId, card.id, { provider: "stripe", ref: "pi_test" })).toBe(
    true,
  );
  const view = await findGiftCardByCode(fx.tenantId, card.code);
  if (!view) throw new Error("card vanished after activation");
  return view;
}

/** The stored row, for the columns a view does not expose. */
async function cardRow(tenantId: string, id: string) {
  return asTenant(tenantId, (tx) =>
    tx.giftCard.findFirstOrThrow({
      where: { id },
      select: {
        status: true,
        valueCents: true,
        paidAt: true,
        expiresAt: true,
        redeemedAt: true,
        redeemedByUserId: true,
        redeemedOrderId: true,
        redeemedNote: true,
        paymentProvider: true,
        paymentRef: true,
      },
    }),
  );
}

/** Push a card's expiry into the past without touching its status — the
 *  clock ticking over is exactly what no cron ever notices. */
async function expireByClock(tenantId: string, id: string): Promise<void> {
  await asTenant(tenantId, (tx) =>
    tx.giftCard.updateMany({ where: { id }, data: { expiresAt: new Date(Date.now() - 60_000) } }),
  );
}

/** Venue-local wall clock of an instant, as one lookup. */
function berlinParts(at: Date): (kind: string) => string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  return (kind) => parts.find((p) => p.type === kind)?.value ?? "";
}

// One cleanup for the whole file: every describe mints its own tenant, so
// a per-describe hook would run before the later ones had.
afterAll(async () => {
  for (const tid of tenantIds) {
    await asTenant(tid, (tx) => tx.giftCard.deleteMany({}));
    await asTenant(tid, (tx) => tx.giftCardProduct.deleteMany({}));
    await asTenant(tid, (tx) => tx.orderItem.deleteMany({}));
    await asTenant(tid, (tx) => tx.order.deleteMany({}));
    await asTenant(tid, (tx) => tx.customer.deleteMany({}));
    await asTenant(tid, (tx) => tx.venue.deleteMany({}));
    await asTenant(tid, (tx) => tx.membership.deleteMany({}));
    await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

/* ------------------------------------------------------------------ */
/* Expiry — pure, no database                                          */
/* ------------------------------------------------------------------ */

describe("giftCardExpiry", () => {
  it("lands on the same day-of-month, 36 months out, at the last second of that day", () => {
    const paidAt = new Date("2026-05-14T10:00:00Z");
    const expires = giftCardExpiry("Europe/Berlin", 36, paidAt);
    const get = berlinParts(expires);
    expect(`${get("year")}-${get("month")}-${get("day")}`).toBe("2029-05-14");
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("23:59:59");
  });

  it("clamps a day-of-month the target month does not have", () => {
    // Paid 31 August + 6 months is 28 February — NOT 3 March. Rolling
    // forward would hand the guest days they never bought and, worse,
    // put a different date on the card than on the record.
    const expires = giftCardExpiry("Europe/Berlin", 6, new Date("2026-08-31T10:00:00Z"));
    expect(berlinParts(expires)("day")).toBe("28");
    expect(berlinParts(expires)("month")).toBe("02");
    expect(berlinParts(expires)("year")).toBe("2027");

    // A month that DOES have the day keeps it.
    const july = giftCardExpiry("Europe/Berlin", 6, new Date("2026-01-31T10:00:00Z"));
    expect(`${berlinParts(july)("month")}-${berlinParts(july)("day")}`).toBe("07-31");
  });

  it("clamps 29 February to 28 February a year later", () => {
    const expires = giftCardExpiry("Europe/Berlin", 12, new Date("2024-02-29T10:00:00Z"));
    const get = berlinParts(expires);
    expect(`${get("year")}-${get("month")}-${get("day")}`).toBe("2025-02-28");
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("23:59:59");
  });

  it("ends the correct LOCAL day across a DST boundary", () => {
    // Paid in CET (UTC+1), expires in CEST (UTC+2). A naive
    // "+N months in UTC" would land an hour out and expire the card at
    // 22:59:59 local — an hour of a guest's last day, gone.
    const expires = giftCardExpiry("Europe/Berlin", 4, new Date("2026-01-15T10:00:00Z"));
    expect(expires.toISOString()).toBe("2026-05-15T21:59:59.000Z");
    const get = berlinParts(expires);
    expect(`${get("year")}-${get("month")}-${get("day")}`).toBe("2026-05-15");
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("23:59:59");
  });

  it("counts from the VENUE's date, not the UTC one", () => {
    // 23:30 UTC on 28 Feb is already 1 March in Berlin, and 1 March is
    // the date printed on the card.
    const expires = giftCardExpiry("Europe/Berlin", 36, new Date("2026-02-28T23:30:00Z"));
    const get = berlinParts(expires);
    expect(`${get("year")}-${get("month")}-${get("day")}`).toBe("2029-03-01");
  });

  it("is strictly before midnight of the following local day", () => {
    const expires = giftCardExpiry("Europe/Berlin", 36, new Date("2026-05-14T10:00:00Z"));
    // One second later is the 15th — which is what proves "end of the
    // 14th" rather than "some time on the 14th".
    const next = new Date(expires.getTime() + 1000);
    const get = berlinParts(next);
    expect(`${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`).toBe("15 00:00:00");
  });
});

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

describe("gift card products", () => {
  it("seeds the three designs lazily, and seeding twice does not make six", async () => {
    const fx = await fixture();
    const first = await listGiftCardProducts(fx.tenantId, fx.venueId);
    expect(first.map((p) => [p.name, p.priceCents])).toEqual(
      DEFAULT_GIFT_CARD_PRODUCTS.map((p) => [p.name, p.priceCents]),
    );
    expect(first.map((p) => p.sortIndex)).toEqual([0, 1, 2]);

    // The seed is idempotent by a partial unique index, not by a guard in
    // application code — so calling it again is the test.
    const second = await listGiftCardProducts(fx.tenantId, fx.venueId);
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
    const count = await asTenant(fx.tenantId, (tx) =>
      tx.giftCardProduct.count({ where: { venueId: fx.venueId } }),
    );
    expect(count).toBe(3);
  });

  it("shows guests only active designs, and nothing at all while the switch is off", async () => {
    const fx = await fixture();
    const on = parseGiftCardConfig({ enabled: true });
    expect(await listActiveGiftCardProducts(fx.tenantId, fx.venueId, on)).toHaveLength(3);

    const retired = await productAt(fx, 1);
    await asTenant(fx.tenantId, (tx) =>
      tx.giftCardProduct.updateMany({ where: { id: retired.id }, data: { active: false } }),
    );
    const visible = await listActiveGiftCardProducts(fx.tenantId, fx.venueId, on);
    expect(visible.map((p) => p.id)).not.toContain(retired.id);
    expect(visible).toHaveLength(2);
    // The owner's editor still sees it — retiring a design is not deleting it.
    expect((await listGiftCardProducts(fx.tenantId, fx.venueId)).map((p) => p.id)).toContain(
      retired.id,
    );

    const off = parseGiftCardConfig({ enabled: false });
    expect(await listActiveGiftCardProducts(fx.tenantId, fx.venueId, off)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Buying + activation                                                 */
/* ------------------------------------------------------------------ */

describe("buying a gift card", () => {
  it("prices the card from the GUEST'S amount, not the design, and is born unpaid", async () => {
    const fx = await fixture();
    const product = await productAt(fx, 2); // Festmahl, suggested €100
    // The guest picked €40 on a design that suggests €100 — the card is
    // worth €40, and the suggestion is just the placeholder they typed
    // over.
    const card = await buy(fx, 2, fx.venueId, 4000);

    expect(card.valueCents).toBe(4000);
    expect(card.valueCents).not.toBe(product.priceCents);
    expect(card.status).toBe("pending_payment");
    expect(card.recipientName).toBe("Simran");
    // No clock runs on a card nobody has paid for, and there is nothing
    // to share yet — the buyer has not bought anything.
    expect(card.paidAt).toBeNull();
    expect(card.expiresAt).toBeNull();
    expect(card.shareUrl).toBeNull();
    expect(normalizeGiftCardCode(card.code)).toBe(card.code);

    expect(await cardRow(fx.tenantId, card.id)).toMatchObject({
      status: "pending_payment",
      valueCents: 4000,
      paidAt: null,
      expiresAt: null,
    });
  });

  it("still accepts the design's suggested amount — it is a default, not a ceiling", async () => {
    const fx = await fixture();
    const product = await productAt(fx, 0); // Kleine Freude, suggested €25
    const card = await buy(fx, 0, fx.venueId, product.priceCents);
    expect(card.valueCents).toBe(product.priceCents);
  });

  it("refuses an amount outside the bounds, and mints nothing on the way", async () => {
    const fx = await fixture();
    const product = await productAt(fx, 0);

    const refuse = async (amountCents: number): Promise<unknown> =>
      createGiftCardPurchase(fx.tenantId, fx.venueId, fx.customerId, product.id, {
        amountCents,
        phone: "07531 123456",
      });

    // Below €5: costs more to process than it is worth.
    expect(await refuse(GIFT_CARD_AMOUNT.minCents - 100)).toEqual({
      ok: false,
      error: "invalid_amount",
    });
    expect(await refuse(0)).toEqual({ ok: false, error: "invalid_amount" });
    expect(await refuse(-5000)).toEqual({ ok: false, error: "invalid_amount" });
    // Above €500: stored value we owe for three years.
    expect(await refuse(GIFT_CARD_AMOUNT.maxCents + 100)).toEqual({
      ok: false,
      error: "invalid_amount",
    });
    // Not a whole euro.
    expect(await refuse(4763)).toEqual({ ok: false, error: "invalid_amount" });
    // Not an integer number of cents at all.
    expect(await refuse(2500.5)).toEqual({ ok: false, error: "invalid_amount" });

    // The bounds themselves are INSIDE the range.
    const low = await createGiftCardPurchase(fx.tenantId, fx.venueId, fx.customerId, product.id, {
      phone: "07531 123456",
      amountCents: GIFT_CARD_AMOUNT.minCents,
    });
    expect(low.ok && low.card.valueCents).toBe(GIFT_CARD_AMOUNT.minCents);
    const high = await createGiftCardPurchase(fx.tenantId, fx.venueId, fx.customerId, product.id, {
      phone: "07531 123456",
      amountCents: GIFT_CARD_AMOUNT.maxCents,
    });
    expect(high.ok && high.card.valueCents).toBe(GIFT_CARD_AMOUNT.maxCents);

    // Exactly the two that were allowed, and not one refusal, reached
    // the table — the bounds check runs before anything is written.
    expect(await asTenant(fx.tenantId, (tx) => tx.giftCard.count({ where: {} }))).toBe(2);
  });

  it("refuses an unknown product, a retired one, and a venue with gift cards switched off", async () => {
    const fx = await fixture();
    const product = await productAt(fx, 0);

    expect(
      await createGiftCardPurchase(fx.tenantId, fx.venueId, fx.customerId, "no-such-product", {
        phone: "07531 123456",
        amountCents: 2500,
      }),
    ).toEqual({ ok: false, error: "unknown_product" });

    await asTenant(fx.tenantId, (tx) =>
      tx.giftCardProduct.updateMany({ where: { id: product.id }, data: { active: false } }),
    );
    // A design the owner pulled this morning must not still be sellable
    // from a screen the guest opened before that.
    expect(
      await createGiftCardPurchase(fx.tenantId, fx.venueId, fx.customerId, product.id, {
        phone: "07531 123456",
        amountCents: 2500,
      }),
    ).toEqual({ ok: false, error: "unknown_product" });

    const disabled = await fixture({ enabled: false });
    const theirProduct = await productAt(disabled, 0);
    expect(
      await createGiftCardPurchase(
        disabled.tenantId,
        disabled.venueId,
        disabled.customerId,
        theirProduct.id,
        { phone: "07531 123456", amountCents: 2500 },
      ),
    ).toEqual({ ok: false, error: "disabled" });
    // …and nothing was minted on the way to that refusal.
    expect(await asTenant(disabled.tenantId, (tx) => tx.giftCard.count({ where: {} }))).toBe(0);
  });
});

describe("activating a gift card", () => {
  it("stamps the payment, starts the clock, and makes the card spendable", async () => {
    const fx = await fixture({ enabled: true, expiryMonths: 36 });
    const card = await buy(fx);

    expect(
      await activateGiftCard(fx.tenantId, card.id, { provider: "stripe", ref: "pi_abc" }),
    ).toBe(true);

    const row = await cardRow(fx.tenantId, card.id);
    expect(row).toMatchObject({
      status: "active",
      paymentProvider: "stripe",
      paymentRef: "pi_abc",
    });
    expect(row.paidAt).toBeInstanceOf(Date);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    // 36 months out, at the last second of that venue-local day.
    const get = berlinParts(row.expiresAt!);
    expect(`${get("hour")}:${get("minute")}:${get("second")}`).toBe("23:59:59");
    expect(row.expiresAt!.toISOString()).toBe(
      giftCardExpiry("Europe/Berlin", 36, row.paidAt!).toISOString(),
    );

    // Paid ⇒ there is now a link to forward.
    const view = await findGiftCardByCode(fx.tenantId, card.code);
    expect(view).toMatchObject({ status: "active" });
    expect(view?.shareUrl).toContain(view!.codeFormatted);
  });

  it("honours the venue's own expiry term", async () => {
    const fx = await fixture({ enabled: true, expiryMonths: 12 });
    const card = await buy(fx);
    await activateGiftCard(fx.tenantId, card.id, { provider: "stripe", ref: "pi_year" });
    const row = await cardRow(fx.tenantId, card.id);
    expect(row.expiresAt!.toISOString()).toBe(
      giftCardExpiry("Europe/Berlin", 12, row.paidAt!).toISOString(),
    );
  });

  it("is idempotent: a replayed webhook does not move the dates", async () => {
    // Stripe retries, the PayPal return leg and the dev fake-confirm all
    // race for this one write. A second winner would re-stamp `paidAt`,
    // which silently EXTENDS the card by however long the replay was
    // delayed, and would email the buyer their card twice.
    const fx = await fixture();
    const card = await buy(fx);
    expect(await activateGiftCard(fx.tenantId, card.id, { provider: "stripe", ref: "pi_1" })).toBe(
      true,
    );
    const first = await cardRow(fx.tenantId, card.id);

    expect(await activateGiftCard(fx.tenantId, card.id, { provider: "paypal", ref: "pay_2" })).toBe(
      false,
    );
    const second = await cardRow(fx.tenantId, card.id);
    expect(second.paidAt!.toISOString()).toBe(first.paidAt!.toISOString());
    expect(second.expiresAt!.toISOString()).toBe(first.expiresAt!.toISOString());
    expect(second.paymentProvider).toBe("stripe");
    expect(second.paymentRef).toBe("pi_1");
  });

  it("never activates a card that is not awaiting payment", async () => {
    const fx = await fixture();
    const card = await activeCard(fx);
    await asTenant(fx.tenantId, (tx) =>
      tx.giftCard.updateMany({ where: { id: card.id }, data: { status: "refunded" } }),
    );
    expect(await activateGiftCard(fx.tenantId, card.id, { provider: "stripe", ref: "pi_x" })).toBe(
      false,
    );
    expect((await cardRow(fx.tenantId, card.id)).status).toBe("refunded");
    // An id that is not a card at all is a false, not a throw.
    expect(
      await activateGiftCard(fx.tenantId, "no-such-card", { provider: "stripe", ref: null }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The redeem state machine                                            */
/* ------------------------------------------------------------------ */

describe("redeeming a gift card at the counter", () => {
  it("takes an active card once and records who took it", async () => {
    const fx = await fixture();
    const card = await activeCard(fx);

    const taken = await redeemGiftCardAtCounter(
      fx.tenantId,
      card.code,
      fx.staffUserId,
      " table 7 ",
    );
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.card).toMatchObject({ id: card.id, status: "redeemed" });
    expect(taken.card.redemption).toMatchObject({ kind: "counter", note: "table 7" });

    const row = await cardRow(fx.tenantId, card.id);
    expect(row.status).toBe("redeemed");
    expect(row.redeemedAt).toBeInstanceOf(Date);
    expect(row.redeemedByUserId).toBe(fx.staffUserId);
    // Counter and order redemption are mutually exclusive.
    expect(row.redeemedOrderId).toBeNull();

    // The dashed, lower-case and URL spellings all reach the same card.
    expect(
      await findGiftCardByCode(fx.tenantId, taken.card.codeFormatted.toLowerCase()),
    ).toMatchObject({ id: card.id, status: "redeemed" });
  });

  it("names every refusal rather than collapsing them into `invalid`", async () => {
    const fx = await fixture();

    // A code we have never issued — "check what you typed".
    expect(
      await redeemGiftCardAtCounter(fx.tenantId, generateGiftCardCode(), fx.staffUserId),
    ).toEqual({ ok: false, error: "unknown" });
    // …and one that is not even shaped like a code.
    expect(await redeemGiftCardAtCounter(fx.tenantId, "NOPE", fx.staffUserId)).toEqual({
      ok: false,
      error: "unknown",
    });

    const unpaid = await buy(fx);
    expect(await redeemGiftCardAtCounter(fx.tenantId, unpaid.code, fx.staffUserId)).toEqual({
      ok: false,
      error: "not_paid",
    });

    const spent = await activeCard(fx);
    expect((await redeemGiftCardAtCounter(fx.tenantId, spent.code, fx.staffUserId)).ok).toBe(true);
    expect(await redeemGiftCardAtCounter(fx.tenantId, spent.code, fx.staffUserId)).toEqual({
      ok: false,
      error: "already_redeemed",
    });

    const refunded = await activeCard(fx);
    await asTenant(fx.tenantId, (tx) =>
      tx.giftCard.updateMany({ where: { id: refunded.id }, data: { status: "refunded" } }),
    );
    expect(await redeemGiftCardAtCounter(fx.tenantId, refunded.code, fx.staffUserId)).toEqual({
      ok: false,
      error: "refunded",
    });
  });

  it("expires a stale card lazily, on the read AND on the redeem", async () => {
    const fx = await fixture();
    const card = await activeCard(fx);
    await expireByClock(fx.tenantId, card.id);

    // No cron ran. The read itself is what flips the row.
    expect(await findGiftCardByCode(fx.tenantId, card.code)).toMatchObject({ status: "expired" });
    expect((await cardRow(fx.tenantId, card.id)).status).toBe("expired");
    expect(await redeemGiftCardAtCounter(fx.tenantId, card.code, fx.staffUserId)).toEqual({
      ok: false,
      error: "expired",
    });

    // And one that ticks over with nothing having read it first is refused
    // all the same — the redeem path does not trust the stored status.
    const second = await activeCard(fx);
    await expireByClock(fx.tenantId, second.id);
    expect(await redeemGiftCardAtCounter(fx.tenantId, second.code, fx.staffUserId)).toEqual({
      ok: false,
      error: "expired",
    });
    expect((await cardRow(fx.tenantId, second.id)).redeemedAt).toBeNull();
  });

  it("lets exactly ONE of two simultaneous counter redemptions win", async () => {
    // Two tills, one card, the same second. Single use means single use:
    // the loser must be told `already_redeemed`, not handed a free meal.
    const fx = await fixture();
    const card = await activeCard(fx);

    const [a, b] = await Promise.all([
      redeemGiftCardAtCounter(fx.tenantId, card.code, fx.staffUserId, "till 1"),
      redeemGiftCardAtCounter(fx.tenantId, card.code, fx.staffUserId, "till 2"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser).toEqual({ ok: false, error: "already_redeemed" });

    const row = await cardRow(fx.tenantId, card.id);
    expect(row.status).toBe("redeemed");
    // One note, from the till that actually won — never both.
    expect(["till 1", "till 2"]).toContain(row.redeemedNote);
  });
});

describe("claiming a gift card for an order", () => {
  it("refuses a card belonging to another venue, and leaves it spendable", async () => {
    // Cards are venue money, not tenant money: a chain's north branch
    // must not be able to spend a card its south branch sold.
    const fx = await fixture();
    const otherVenueId = await secondVenue(fx);
    const card = await activeCard(fx);

    const claim = await asTenant(fx.tenantId, (tx) =>
      claimGiftCardForOrder(tx, card.code, otherVenueId, 10_000),
    );
    expect(claim).toBeNull();
    // Refused, not consumed — the guest can still spend it where it belongs.
    expect((await cardRow(fx.tenantId, card.id)).status).toBe("active");

    const good = await asTenant(fx.tenantId, (tx) =>
      claimGiftCardForOrder(tx, card.code, fx.venueId, 10_000),
    );
    expect(good).toMatchObject({ giftCardId: card.id, discountCents: card.valueCents });
  });

  it("caps the discount at the bill and still consumes the card", async () => {
    // SINGLE USE, FULL VALUE: a €25 card against a €10 bill loses €15.
    // That is the documented rule, it is printed on the card, and the
    // cart makes the guest acknowledge the amount before this runs.
    const fx = await fixture();
    const card = await activeCard(fx, 0); // Kleine Freude, €25
    expect(card.valueCents).toBe(2500);

    const claim = await asTenant(fx.tenantId, (tx) =>
      claimGiftCardForOrder(tx, card.code, fx.venueId, 1000),
    );
    expect(claim?.discountCents).toBe(1000);
    expect((await cardRow(fx.tenantId, card.id)).status).toBe("redeemed");
  });

  it("returns null for an unknown, unpaid or expired code rather than throwing", async () => {
    // The cart treats this as advisory: a bad code costs a discount, not
    // the order.
    const fx = await fixture();
    const unpaid = await buy(fx);
    const stale = await activeCard(fx);
    await expireByClock(fx.tenantId, stale.id);

    for (const code of [generateGiftCardCode(), "NOPE", unpaid.code, stale.code]) {
      expect(
        await asTenant(fx.tenantId, (tx) => claimGiftCardForOrder(tx, code, fx.venueId, 5000)),
      ).toBeNull();
    }
    // Nothing was consumed on the way to those refusals. Note the claim
    // path deliberately does NOT run the lazy-expiry write — it sits
    // inside the guest's checkout transaction, so `refusalFor` compares
    // `expiresAt` directly and leaves flipping the status to the next
    // READ of that card. What matters here is that the stale card is
    // refused and stays unspent, not what its stored label says.
    expect((await cardRow(fx.tenantId, unpaid.id)).status).toBe("pending_payment");
    expect(await cardRow(fx.tenantId, stale.id)).toMatchObject({
      redeemedAt: null,
      redeemedOrderId: null,
    });
    // …and the next read is what writes `expired` down.
    expect(await findGiftCardByCode(fx.tenantId, stale.code)).toMatchObject({ status: "expired" });
    expect((await cardRow(fx.tenantId, stale.id)).status).toBe("expired");
  });
});
