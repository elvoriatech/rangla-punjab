import { asTenant, asUser } from "./tenant";
import { getStripeProvider, stripeProviderForKey, stripeDirectChargeAvailable } from "./stripe";
import type { StripeProvider } from "./stripe/provider";
import { resolvePublishableKey } from "./stripe/publishable-key";
import { computePlatformFeeCents, getOperatorSettings } from "./operator-settings";
import { decryptSecret } from "./secrets";
import { siteUrl } from "./site-url";
import { verifyReceiptToken } from "./receipt-token";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * Guest online payments via Stripe Connect (Scale tier).
 *
 * Money model: the guest pays the RESTAURANT — funds settle to the
 * restaurant's connected account; Guesto takes an application fee per
 * order. Guesto never holds the restaurant's money (no payment-
 * institution licence needed).
 *
 * The gate is double: the tenant must be entitled (Scale / trial /
 * override) AND the connected account must have charges enabled
 * (Stripe's KYC passed). Both are re-checked server-side on every call.
 */

export interface ConnectStatus {
  entitled: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
}

export async function getConnectStatus(userId: string): Promise<ConnectStatus | null> {
  return asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirst({
      select: {
        stripeAccountId: true,
        stripeChargesEnabled: true,
      },
    });
    if (!tenant) return null;
    // P2-3: payments are no longer subscription-gated (white-label, one
    // restaurant). The only remaining gate is Stripe's own charges-enabled
    // (KYC) flag, checked at checkout.
    return {
      entitled: true,
      accountId: tenant.stripeAccountId,
      chargesEnabled: tenant.stripeChargesEnabled,
    };
  });
}

export type OnboardResult = { ok: true; url: string };

/** Start (or resume) Connect onboarding; returns the hosted-flow URL.
 *  The fake provider completes instantly and bounces back enabled. */
export async function startConnectOnboarding(
  userId: string,
  ownerEmail: string,
  returnPath: string,
): Promise<OnboardResult | null> {
  const provider = await getStripeProvider();
  return asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirst({
      select: {
        id: true,
        stripeAccountId: true,
      },
    });
    if (!tenant) return null;
    // P2-3: no subscription/entitlement gate — the owner can always set up
    // Connect on this deploy.

    let accountId = tenant.stripeAccountId;
    if (!accountId) {
      const account = await provider.createConnectAccount({
        tenantId: tenant.id,
        email: ownerEmail,
      });
      accountId = account.id;
      await tx.tenant.updateMany({ data: { stripeAccountId: accountId } });
    }
    const link = await provider.createConnectOnboardingLink({
      accountId,
      returnUrl: `${siteUrl()}${returnPath}?connect=done`,
      refreshUrl: `${siteUrl()}${returnPath}?connect=retry`,
    });
    return { ok: true as const, url: link.url };
  });
}

/** Refresh the charges-enabled mirror after onboarding returns (real
 *  Stripe also pushes account.updated webhooks; this covers the bounce). */
export async function refreshConnectStatus(userId: string): Promise<void> {
  const provider = await getStripeProvider();
  await asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirst({ select: { stripeAccountId: true } });
    if (!tenant?.stripeAccountId) return;
    const status = await provider.getConnectAccountStatus(tenant.stripeAccountId);
    await tx.tenant.updateMany({ data: { stripeChargesEnabled: status.chargesEnabled } });
  });
}

export type PayResult =
  | { ok: true; url: string }
  | { ok: false; error: "invalid_token" | "not_found" | "not_available" | "already_paid" };

/** The own-keys columns the direct-charge routing reads. */
interface OwnKeyColumns {
  stripeOwnEnabled: boolean;
  stripeOwnSecretEnc: string | null;
  stripeOwnWebhookEnc: string | null;
}

/**
 * Which Stripe account charges this order directly (no Connect, no
 * platform fee)? Keys pasted in Dashboard → Payments describe the
 * restaurant's own account and win; otherwise the deployment's STRIPE_*
 * keys ARE that account (single-restaurant build). Null means nothing may
 * charge — in practice a fake provider in production, which must never
 * mark an order paid without money moving.
 *
 * Shared by the hosted-checkout path and the native-payment-sheet path so
 * the two can never disagree about whose account the guest is paying.
 */
async function selectDirectChargeProvider(
  tenant: OwnKeyColumns,
  shared: StripeProvider,
): Promise<{ provider: StripeProvider; ownKeys: boolean } | null> {
  const ownSecret = tenant.stripeOwnEnabled ? decryptSecret(tenant.stripeOwnSecretEnc) : null;
  if (ownSecret) {
    return {
      provider: await stripeProviderForKey(ownSecret, decryptSecret(tenant.stripeOwnWebhookEnc)),
      ownKeys: true,
    };
  }
  if (await stripeDirectChargeAvailable(false)) return { provider: shared, ownKeys: false };
  return null;
}

/** Create the checkout for one order. Guest-facing: authenticated by
 *  the order's HMAC receipt token, priced from the stored order —
 *  nothing from the client is trusted. */
export async function createOrderPayment(
  tenantId: string,
  orderId: string,
  token: string,
): Promise<PayResult> {
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId || verified.tenantId !== tenantId) {
    return { ok: false, error: "invalid_token" };
  }
  const provider = await getStripeProvider();
  return asTenant(tenantId, async (tx) => {
    const [tenant, order] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          stripeAccountId: true,
          stripeChargesEnabled: true,
          stripeOwnEnabled: true,
          stripeOwnSecretEnc: true,
          stripeOwnWebhookEnc: true,
        },
      }),
      tx.order.findFirst({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          totalCents: true,
          currency: true,
          paymentStatus: true,
          venue: { select: { name: true, slug: true } },
        },
      }),
    ]);
    if (!order) return { ok: false, error: "not_found" as const };
    if (order.paymentStatus === "paid") return { ok: false, error: "already_paid" as const };

    const settings = await getOperatorSettings();
    const menuUrl = `${siteUrl()}/`;
    const payPage = `${siteUrl()}/pay/${order.id}?token=${encodeURIComponent(token)}`;
    const label = `${order.venue.name} — order #${String(order.orderNumber).padStart(4, "0")}`;

    // Direct charge (single-restaurant / upfront plan): the restaurant
    // charges on its OWN Stripe account and keeps 100% — no connected
    // account, no platform fee. Keys pasted in Dashboard → Payments win;
    // otherwise the deployment's STRIPE_* env keys (prod.env) are that
    // account. Only a fake provider in production is refused, so an
    // order can never be "paid" without money moving.
    if (settings.feeMode === "upfront") {
      const direct = await selectDirectChargeProvider(tenant, provider);
      if (!direct) return { ok: false, error: "not_available" as const };
      {
        const ownProvider = direct.provider;
        const checkout = await ownProvider.createDirectCheckout({
          orderId: order.id,
          tenantId,
          amountCents: order.totalCents,
          currency: order.currency,
          label,
          successUrl: `${payPage}&status=success`,
          cancelUrl: menuUrl,
          payPageUrl: payPage,
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: "pending",
            paymentRef: checkout.ref,
            paymentProvider: "stripe",
            applicationFeeCents: 0,
          },
        });
        log.info("payment.checkout_created", {
          orderId,
          tenantId,
          feeCents: 0,
          mode: ownProvider.mode,
          own: true,
          ownKeys: direct.ownKeys,
        });
        return { ok: true as const, url: checkout.url };
      }
    }

    // Connect path (percentage plan only — unreachable in the single-
    // restaurant build, where feeMode is pinned to "upfront"): needs the
    // restaurant's connected account to exist and have passed Stripe KYC.
    if (!tenant.stripeAccountId || !tenant.stripeChargesEnabled) {
      return { ok: false, error: "not_available" as const };
    }

    const feeCents = computePlatformFeeCents(order.totalCents, settings);
    const checkout = await provider.createOrderCheckout({
      accountId: tenant.stripeAccountId,
      orderId: order.id,
      tenantId,
      amountCents: order.totalCents,
      feeCents,
      currency: order.currency,
      label: `${order.venue.name} — order #${String(order.orderNumber).padStart(4, "0")}`,
      successUrl: `${payPage}&status=success`,
      cancelUrl: menuUrl,
      payPageUrl: payPage,
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "pending",
        paymentRef: checkout.ref,
        paymentProvider: "stripe",
        applicationFeeCents: feeCents,
      },
    });
    log.info("payment.checkout_created", { orderId, tenantId, feeCents, mode: provider.mode });
    return { ok: true as const, url: checkout.url };
  });
}

export type PaymentIntentResult =
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
      error:
        | "invalid_token"
        | "not_found"
        | "not_available"
        | "already_paid"
        | "publishable_key_missing";
    };

/**
 * The native-app sibling of `createOrderPayment`: instead of a hosted
 * checkout URL to open in a browser, hand back a PaymentIntent the app's
 * Stripe PaymentSheet confirms in-process. Same auth (the order's HMAC
 * receipt token), same server-side pricing — nothing from the client is
 * trusted — and the same account routing, so an order can be started on
 * either surface and settles through the same webhook.
 *
 * Only the direct-charge (upfront) model is supported: a Connect
 * destination charge needs an application fee and the connected account's
 * own publishable key, which this contract has no room for. Percentage
 * deployments get `not_available` and the app falls back to /pay.
 *
 * Re-calling for an unpaid order mints a FRESH intent and overwrites
 * `paymentRef`. That is the retry path (guest dismissed the sheet, card
 * declined); the abandoned intent expires on Stripe's side and can never
 * settle an order the new ref has since paid, because settlement is
 * keyed on orderId and idempotent.
 */
export async function createOrderPaymentIntent(
  tenantId: string,
  orderId: string,
  token: string,
): Promise<PaymentIntentResult> {
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId || verified.tenantId !== tenantId) {
    return { ok: false, error: "invalid_token" };
  }
  const shared = await getStripeProvider();
  return asTenant(tenantId, async (tx) => {
    const [tenant, order] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: {
          stripeOwnEnabled: true,
          stripeOwnSecretEnc: true,
          stripeOwnWebhookEnc: true,
          stripeOwnPublishable: true,
        },
      }),
      tx.order.findFirst({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          totalCents: true,
          currency: true,
          paymentStatus: true,
          venue: { select: { name: true } },
        },
      }),
    ]);
    if (!order) return { ok: false, error: "not_found" as const };
    if (order.paymentStatus === "paid") return { ok: false, error: "already_paid" as const };

    const settings = await getOperatorSettings();
    if (settings.feeMode !== "upfront") return { ok: false, error: "not_available" as const };

    const direct = await selectDirectChargeProvider(tenant, shared);
    if (!direct) return { ok: false, error: "not_available" as const };

    // A real intent without its matching publishable key is unusable in
    // the app — refuse here rather than hand out a secret the sheet
    // cannot open, so the app falls back to the hosted checkout.
    const publishableKey = direct.provider.mode === "real" ? resolvePublishableKey(tenant) : null;
    if (direct.provider.mode === "real" && !publishableKey) {
      return { ok: false, error: "publishable_key_missing" as const };
    }

    const label = `${order.venue.name} — order #${String(order.orderNumber).padStart(4, "0")}`;
    const intent = await direct.provider.createDirectPaymentIntent({
      orderId: order.id,
      tenantId,
      amountCents: order.totalCents,
      currency: order.currency,
      label,
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "pending",
        paymentRef: intent.ref,
        paymentProvider: "stripe",
        applicationFeeCents: 0,
      },
    });
    log.info("payment.intent_created", {
      orderId,
      tenantId,
      feeCents: 0,
      mode: direct.provider.mode,
      own: true,
      ownKeys: direct.ownKeys,
    });
    return {
      ok: true as const,
      mode: direct.provider.mode,
      ref: intent.ref,
      clientSecret: intent.clientSecret,
      publishableKey,
      amountCents: order.totalCents,
      currency: order.currency,
      merchantName: order.venue.name,
    };
  });
}

/** Settle an order — called by the webhook (real) or the fake confirm
 *  endpoint. Idempotent: paying a paid order is a no-op. */
export async function markOrderPaid(tenantId: string, orderId: string): Promise<boolean> {
  return asTenant(tenantId, async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, paymentStatus: "pending" },
      data: { paymentStatus: "paid" },
    });
    if (updated.count > 0) log.info("payment.settled", { orderId, tenantId });
    return updated.count > 0;
  }).then(async (settled) => {
    // The receipt email for an online order goes out when the money has
    // actually moved — never from the placement step. Fire-and-forget:
    // a mail failure must not turn a successful webhook into a 500.
    // Dynamic import keeps order-service ↔ connect-service acyclic.
    if (settled) {
      const { sendReceiptEmailForOrder } = await import("./receipt-email");
      void sendReceiptEmailForOrder(tenantId, orderId);
      const { sendNewOrderNotification } = await import("./order-notification");
      void sendNewOrderNotification(tenantId, orderId);
    }
    return settled;
  });
}
