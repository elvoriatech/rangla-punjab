import { selectDirectChargeProvider } from "./connect-service";
import { activateGiftCard, stampGiftCardPayment } from "./gift-card-service";
import { createLogger } from "./logger";
import { getOperatorSettings } from "./operator-settings";
import { payPalProviderFor } from "./paypal";
import { siteUrl } from "./site-url";
import { getStripeProvider } from "./stripe";
import { resolvePublishableKey } from "./stripe/publishable-key";
import { asTenant } from "./tenant";
import { getPayPalKeysForTenant } from "./tenant-payment-keys";

/**
 * Paying for a gift card.
 *
 * The sibling of `connect-service.ts`, and deliberately a separate file:
 * everything there is priced from an ORDER, and a gift card is a sale of
 * stored value with no order behind it — no kitchen, no receipt number,
 * no delivery fee. What the two share is the account-selection seam
 * (`selectDirectChargeProvider`), so a venue's own Stripe keys charge
 * gift cards exactly as they charge food.
 *
 * Authentication differs too. An order's payment is authorised by its
 * HMAC receipt token, because orders are placed anonymously. A gift card
 * is always bought by a signed-in guest, so the route authenticates the
 * CUSTOMER and this layer takes the already-verified ids — there is no
 * token to forge.
 */

const log = createLogger();

/** `orders.payment_provider`-style value stored on the card. */
const STRIPE = "stripe";
const PAYPAL = "paypal";

/**
 * PayPal identifies what was bought by a `custom_id` of
 * `<tenantId>:<id>`. A gift card's id is prefixed so the ORDER webhook —
 * which parses the same field — can tell at a glance that this delivery
 * is not about an order, and route it here instead of 400-ing on an
 * order lookup that will never match.
 */
export const PAYPAL_GIFT_CARD_PREFIX = "gc_";

export function payPalGiftCardRef(cardId: string): string {
  return `${PAYPAL_GIFT_CARD_PREFIX}${cardId}`;
}

/** Inverse: the card id inside a PayPal custom id, or null if it is an
 *  ordinary order. */
export function giftCardIdFromPayPalRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith(PAYPAL_GIFT_CARD_PREFIX)) return null;
  const id = ref.slice(PAYPAL_GIFT_CARD_PREFIX.length);
  return id || null;
}

export type GiftCardIntentResult =
  | {
      ok: true;
      mode: "real" | "fake";
      ref: string;
      clientSecret: string;
      /** Null only in fake mode, where the app shows its dev pay button
       *  instead of Stripe's sheet. */
      publishableKey: string | null;
      amountCents: number;
      currency: string;
      merchantName: string;
    }
  | {
      ok: false;
      error: "not_found" | "already_paid" | "not_available" | "publishable_key_missing";
    };

/**
 * A PaymentIntent for the app's native sheet, mirroring
 * `createOrderPaymentIntent` down to its error vocabulary so the mobile
 * client's existing fallback logic (`FALL_BACK_TO_HOSTED`) applies
 * unchanged.
 *
 * The amount is read from the CARD, which was itself priced from the
 * product row — a client cannot name its own price at any point in the
 * chain.
 */
export async function createGiftCardPaymentIntent(
  tenantId: string,
  cardId: string,
): Promise<GiftCardIntentResult> {
  const shared = await getStripeProvider();
  const result = await asTenant(tenantId, async (tx) => {
    const [tenant, card] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          stripeOwnEnabled: true,
          stripeOwnSecretEnc: true,
          stripeOwnWebhookEnc: true,
          stripeOwnPublishable: true,
        },
      }),
      tx.giftCard.findFirst({
        where: { id: cardId },
        select: {
          id: true,
          valueCents: true,
          paidCents: true,
          currency: true,
          status: true,
          venue: { select: { name: true } },
        },
      }),
    ]);
    if (!card) return { ok: false as const, error: "not_found" as const };
    if (card.status !== "pending_payment") {
      return { ok: false as const, error: "already_paid" as const };
    }

    const settings = await getOperatorSettings();
    if (settings.feeMode !== "upfront")
      return { ok: false as const, error: "not_available" as const };

    const direct = await selectDirectChargeProvider(tenant, shared);
    if (!direct) return { ok: false as const, error: "not_available" as const };

    // A real intent whose publishable key is missing is unusable in the
    // app — refuse rather than hand out a secret no sheet can open.
    const publishableKey = direct.provider.mode === "real" ? resolvePublishableKey(tenant) : null;
    if (direct.provider.mode === "real" && !publishableKey) {
      return { ok: false as const, error: "publishable_key_missing" as const };
    }

    // The discounted purchase price (NULL on pre-discount cards = full
    // value). The card itself keeps `valueCents`.
    const chargeCents = card.paidCents ?? card.valueCents;
    const intent = await direct.provider.createDirectPaymentIntent({
      giftCardId: card.id,
      tenantId,
      amountCents: chargeCents,
      currency: card.currency,
      label: `${card.venue.name} — gift card`,
    });
    return {
      ok: true as const,
      mode: direct.provider.mode,
      ref: intent.ref,
      clientSecret: intent.clientSecret,
      publishableKey,
      amountCents: chargeCents,
      currency: card.currency,
      merchantName: card.venue.name,
    };
  });

  if (result.ok) {
    // Outside the transaction so the stamp cannot roll back an intent
    // Stripe has already created — an unstamped card is recoverable
    // (the webhook carries the id in metadata), a charged guest with no
    // card is not.
    await stampGiftCardPayment(tenantId, cardId, { provider: STRIPE, ref: result.ref });
    log.info("giftcard.intent_created", { tenantId, cardId, mode: result.mode });
  }
  return result;
}

export type GiftCardPayPalResult =
  { ok: true; url: string } | { ok: false; error: "not_found" | "already_paid" };

/**
 * Start a PayPal purchase. The approve URL goes to the guest; PayPal
 * returns them to `/api/gift-cards/paypal/return`, which captures and
 * activates. The webhook settles the same purchase independently, and
 * both paths converge on `activateGiftCard`, which is idempotent.
 */
export async function createGiftCardPayPalPayment(
  tenantId: string,
  cardId: string,
  appReturnUrl?: string | null,
): Promise<GiftCardPayPalResult> {
  const provider = payPalProviderFor(await getPayPalKeysForTenant(tenantId));
  const result = await asTenant(tenantId, async (tx) => {
    const card = await tx.giftCard.findFirst({
      where: { id: cardId },
      select: {
        id: true,
        valueCents: true,
        paidCents: true,
        currency: true,
        status: true,
        venue: { select: { name: true } },
      },
    });
    if (!card) return { ok: false as const, error: "not_found" as const };
    if (card.status !== "pending_payment") {
      return { ok: false as const, error: "already_paid" as const };
    }

    const appParam = appReturnUrl ? `&app=${encodeURIComponent(appReturnUrl)}` : "";
    const base = `${siteUrl()}/api/gift-cards/paypal/return?cardId=${encodeURIComponent(card.id)}&tenantId=${encodeURIComponent(tenantId)}`;
    const approval = await provider.createOrderApproval({
      tenantId,
      // Prefixed: see PAYPAL_GIFT_CARD_PREFIX.
      orderId: payPalGiftCardRef(card.id),
      // Discounted purchase price; see createGiftCardPaymentIntent.
      amountCents: card.paidCents ?? card.valueCents,
      currency: card.currency,
      label: `${card.venue.name} — Geschenkgutschein`,
      returnUrl: `${base}${appParam}`,
      cancelUrl: `${siteUrl()}/?giftcard=cancelled`,
    });
    return { ok: true as const, url: approval.url, ref: approval.ref };
  });

  if (!result.ok) return result;
  await stampGiftCardPayment(tenantId, cardId, { provider: PAYPAL, ref: result.ref });
  log.info("giftcard.paypal_created", { tenantId, cardId, mode: provider.mode });
  return { ok: true, url: result.url };
}

/**
 * The PayPal return leg: capture, then activate. Idempotent end to end —
 * a second return finds the card already `active` and reports success
 * rather than charging or emailing twice.
 */
export async function finalizeGiftCardPayPalReturn(
  tenantId: string,
  cardId: string,
): Promise<{ paid: boolean }> {
  const card = await asTenant(tenantId, (tx) =>
    tx.giftCard.findFirst({
      where: { id: cardId },
      select: { status: true, paymentRef: true, paymentProvider: true },
    }),
  );
  if (!card) return { paid: false };
  if (card.status !== "pending_payment") return { paid: true };
  if (card.paymentProvider !== PAYPAL || !card.paymentRef) return { paid: false };

  const provider = payPalProviderFor(await getPayPalKeysForTenant(tenantId));
  const capture = await provider.captureOrder(card.paymentRef);
  if (!capture.paid) return { paid: false };

  await activateGiftCard(tenantId, cardId, { provider: PAYPAL, ref: card.paymentRef });
  return { paid: true };
}

/**
 * Dev/CI only: settle a fake-provider purchase, the way the webhook
 * would. The route that calls this refuses unless the provider really is
 * the fake one, so this can never mark a card paid in production.
 */
export async function settleFakeGiftCardPayment(
  tenantId: string,
  cardId: string,
  ref: string,
): Promise<boolean> {
  return activateGiftCard(tenantId, cardId, { provider: STRIPE, ref });
}
