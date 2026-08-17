import { asTenant, asUser } from "./tenant";
import { getStripeProvider, stripeProviderForKey } from "./stripe";
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

    // Own-keys direct charge (upfront/flat plan): the restaurant charges on
    // their OWN Stripe account and keeps 100% — no connected account or
    // platform fee. Falls through to Connect if own-keys aren't set up.
    if (settings.feeMode === "upfront" && tenant.stripeOwnEnabled) {
      const ownSecret = decryptSecret(tenant.stripeOwnSecretEnc);
      if (ownSecret) {
        const ownProvider = await stripeProviderForKey(
          ownSecret,
          decryptSecret(tenant.stripeOwnWebhookEnc),
        );
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
        });
        return { ok: true as const, url: checkout.url };
      }
    }

    // Connect path (percentage plan, or upfront without own-keys): needs the
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
  });
}
