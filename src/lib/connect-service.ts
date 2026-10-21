import { recordForOrder } from "./order-events";
import { asTenant, asUser } from "./tenant";
import { getStripeProvider, stripeProviderForKey, stripeDirectChargeAvailable } from "./stripe";
import type { StripeProvider } from "./stripe/provider";
import { resolvePublishableKey } from "./stripe/publishable-key";
import { computePlatformFeeCents, getOperatorSettings } from "./operator-settings";
import { decryptSecret } from "./secrets";
import { siteUrl } from "./site-url";
import { verifyReceiptToken } from "./receipt-token";
import { createLogger } from "./logger";
import { orderLabel } from "./order-label";
import {
  closeAttempt,
  createPaymentAttemptTx,
  settleConfirmedPayment,
  type PaymentConfirmation,
  type SettleOutcome,
} from "./payment-settlement";

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
  | {
      ok: false;
      error: "invalid_token" | "not_found" | "not_available" | "already_paid" | "processing";
    };

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
export async function selectDirectChargeProvider(
  tenant: OwnKeyColumns,
  shared: StripeProvider,
): Promise<{ provider: StripeProvider; ownKeys: boolean } | null> {
  // The owner's master switch (Dashboard → Billing → Stripe "Enable",
  // 2026-09-21): OFF means no card payments at all — not even with the
  // deployment's STRIPE_* keys from prod.env behind it.
  if (!tenant.stripeOwnEnabled) return null;
  const ownSecret = decryptSecret(tenant.stripeOwnSecretEnc);
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
  const released = await releaseSupersededStripePayment(tenantId, orderId);
  if (released === "paid") return { ok: false, error: "already_paid" };
  if (released === "processing") return { ok: false, error: "processing" };
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
          venueId: true,
          orderNumber: true,
          orderSeries: true,
          totalCents: true,
          currency: true,
          paymentStatus: true,
          locale: true,
          venue: { select: { name: true, slug: true } },
        },
      }),
    ]);
    if (!order) return { ok: false, error: "not_found" as const };
    if (order.paymentStatus === "paid") return { ok: false, error: "already_paid" as const };

    const settings = await getOperatorSettings();
    const payPage = `${siteUrl()}/pay/${order.id}?token=${encodeURIComponent(token)}`;
    const label = `${order.venue.name} — order #${String(order.orderNumber)}`;

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
          // Back to the pay page, not the menu: that is where the guest
          // is offered try again / pay cash / cancel.
          cancelUrl: `${payPage}&status=cancelled`,
          payPageUrl: payPage,
          locale: order.locale,
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
        await createPaymentAttemptTx(tx, {
          tenantId,
          venueId: order.venueId,
          orderId: order.id,
          orderLabel: orderLabel(order),
          provider: "stripe",
          ref: checkout.ref,
          amountCents: order.totalCents,
          currency: order.currency,
        });
        void recordForOrder(tenantId, orderId, {
          kind: "payment.started",
          actor: "guest",
          summary: `Stripe card page · ${checkout.ref}`,
          payload: { provider: "stripe", ref: checkout.ref, mode: ownProvider.mode, own: true },
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
      label: `${order.venue.name} — order #${String(order.orderNumber)}`,
      successUrl: `${payPage}&status=success`,
      // Back to the pay page, not the menu: that is where the guest
      // is offered try again / pay cash / cancel.
      cancelUrl: `${payPage}&status=cancelled`,
      payPageUrl: payPage,
      locale: order.locale,
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
    await createPaymentAttemptTx(tx, {
      tenantId,
      venueId: order.venueId,
      orderId: order.id,
      orderLabel: orderLabel(order),
      provider: "stripe",
      ref: checkout.ref,
      amountCents: order.totalCents,
      currency: order.currency,
    });
    log.info("payment.checkout_created", { orderId, tenantId, feeCents, mode: provider.mode });
    void recordForOrder(tenantId, orderId, {
      kind: "payment.started",
      actor: "guest",
      summary: `Stripe card page · ${checkout.ref}`,
      payload: { provider: "stripe", ref: checkout.ref, mode: provider.mode, feeCents },
    });
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
        | "processing"
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
 * declined); the abandoned intent is cancelled first
 * (`releaseSupersededStripePayment`) so it can no longer take money.
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
  const released = await releaseSupersededStripePayment(tenantId, orderId);
  if (released === "paid") return { ok: false, error: "already_paid" };
  if (released === "processing") return { ok: false, error: "processing" };
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
          venueId: true,
          orderNumber: true,
          orderSeries: true,
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

    const label = `${order.venue.name} — order #${String(order.orderNumber)}`;
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
    await createPaymentAttemptTx(tx, {
      tenantId,
      venueId: order.venueId,
      orderId: order.id,
      orderLabel: orderLabel(order),
      provider: "stripe",
      ref: intent.ref,
      amountCents: order.totalCents,
      currency: order.currency,
    });
    void recordForOrder(tenantId, orderId, {
      kind: "payment.started",
      actor: "guest",
      summary: `Stripe wallet (Apple/Google Pay) · ${intent.ref}`,
      payload: { provider: "stripe", ref: intent.ref, mode: direct.provider.mode, wallet: true },
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

/**
 * Ask Stripe how a settled order was paid and store it on the order
 * ("apple_pay", "google_pay", "card", …). Stripe reports an Apple/Google
 * Pay payment as a card payment whose card came from a wallet, so without
 * this the dashboard can only ever say "Card". Called once the order is
 * paid; a no-op for cash, PayPal, or when Stripe cannot be asked.
 */
export async function recordPaymentMethod(
  tenantId: string,
  orderId: string,
): Promise<string | null> {
  const shared = await getStripeProvider();
  const found = await asTenant(tenantId, async (tx) => {
    const [tenant, order] = await Promise.all([
      tx.tenant.findFirstOrThrow({
        select: { stripeOwnEnabled: true, stripeOwnSecretEnc: true, stripeOwnWebhookEnc: true },
      }),
      tx.order.findFirst({
        where: { id: orderId },
        select: {
          paymentProvider: true,
          paymentRef: true,
          paymentStatus: true,
          paymentMethod: true,
        },
      }),
    ]);
    return { tenant, order };
  });
  const order = found.order;
  if (!order || order.paymentProvider !== "stripe" || !order.paymentRef) return null;
  if (order.paymentStatus !== "paid" || order.paymentMethod) return order.paymentMethod ?? null;
  // The account that charged it: the restaurant's own keys when set,
  // else the deployment's. A ref Stripe does not know on that account
  // simply answers null.
  const direct = await selectDirectChargeProvider(found.tenant, shared);
  const method = await (direct?.provider ?? shared).paymentMethodOf(order.paymentRef);
  if (!method) return null;
  await asTenant(tenantId, (tx) =>
    tx.order.update({ where: { id: orderId }, data: { paymentMethod: method } }),
  );
  return method;
}

/**
 * Mark an order paid WITHOUT the payment checks — for the local fake pay
 * button only (a fake provider is refused in production) and for tests.
 * Real payments settle through `settleConfirmedPayment`
 * (payment-settlement.ts), which captures only after every check passes.
 * Idempotent: paying a paid order is a no-op.
 */
export async function markOrderPaid(tenantId: string, orderId: string): Promise<boolean> {
  const settled = await asTenant(tenantId, async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, paymentStatus: { in: ["pending", "failed"] } },
      // `paidAt` is when the order reaches the board: the accept window
      // and the promised time are counted from here (`order-eta.ts`).
      data: { paymentStatus: "paid", paidAt: new Date() },
    });
    return updated.count > 0;
  });
  if (settled) {
    log.info("payment.settled", { orderId, tenantId });
    void recordForOrder(tenantId, orderId, {
      kind: "payment.paid",
      actor: "system",
      summary: "Payment confirmed — order is paid",
    });
    await runOrderPaidEffects(tenantId, orderId);
  }
  return settled;
}

/**
 * What follows an order becoming paid, run AFTER the settlement committed.
 * Fire-and-forget: a mail or push failure must never undo a payment.
 */
export async function runOrderPaidEffects(tenantId: string, orderId: string): Promise<void> {
  // The receipt email for an online order goes out when the money has
  // actually moved — never from the placement step. Dynamic imports keep
  // order-service ↔ connect-service acyclic.
  const { sendReceiptEmailForOrder } = await import("./receipt-email");
  void sendReceiptEmailForOrder(tenantId, orderId);
  const { sendNewOrderNotification } = await import("./order-notification");
  void sendNewOrderNotification(tenantId, orderId);
  // The owner's phone hears about an online order on the same rule as
  // their inbox: when the money has actually moved (P7-11).
  const { sendNewOrderPush } = await import("./push-service");
  void sendNewOrderPush(tenantId, orderId);
  // Loyalty points are earned when the money actually moves; idempotent at
  // the database, so racing paths credit the order exactly once.
  const { creditOrderIfEligible } = await import("./loyalty-service");
  void creditOrderIfEligible(tenantId, orderId).catch(() => undefined);
  // Which kind of card it was (Apple Pay / Google Pay / plain card), for
  // the dashboard and the ticket. Best effort.
  void recordPaymentMethod(tenantId, orderId).catch(() => undefined);
}

/** The Stripe account that holds this tenant's order payments: its own
 *  saved keys, else the deployment's — chosen from the keys alone (not the
 *  Billing on/off switch), because reading, capturing or releasing a
 *  payment that already exists must work even after cards were switched
 *  off. */
export async function tenantStripeProvider(tenantId: string): Promise<StripeProvider> {
  const shared = await getStripeProvider();
  const tenant = await asTenant(tenantId, (tx) =>
    tx.tenant.findFirst({ select: { stripeOwnSecretEnc: true, stripeOwnWebhookEnc: true } }),
  );
  const ownSecret = decryptSecret(tenant?.stripeOwnSecretEnc);
  return ownSecret
    ? stripeProviderForKey(ownSecret, decryptSecret(tenant?.stripeOwnWebhookEnc))
    : shared;
}

export type StripeProcessResult =
  | SettleOutcome
  /** Stripe is not done yet (still on the page, or a delayed method is
   *  processing) — nothing to decide. */
  | { kind: "not_ready"; status: string }
  /** Stripe has no such payment on this account. */
  | { kind: "unreadable" };

/**
 * Look at a Stripe order payment AS STRIPE SEES IT NOW and act: reserved
 * → check and capture (or release); already taken → record against the
 * order; expired / cancelled → close the attempt. Every Stripe path calls
 * this — the webhook (whatever event arrived, in whatever order), the pay
 * page's verify, the dashboard sweep and the payment switch — so an event
 * payload is only ever a trigger, never trusted for amount or status.
 */
export async function processStripeOrderPayment(
  tenantId: string,
  ref: string,
  opts: { orderId?: string | null; source: PaymentConfirmation["source"] },
): Promise<StripeProcessResult> {
  const provider = await tenantStripeProvider(tenantId);
  const state = await provider.retrievePaymentIntent(ref);
  if (!state) return { kind: "unreadable" };
  const base = {
    tenantId,
    provider: "stripe" as const,
    ref,
    orderId: opts.orderId ?? null,
    amountCents: state.amountCents,
    currency: state.currency,
    source: opts.source,
  };
  if (state.status === "requires_capture") {
    return settleConfirmedPayment({
      ...base,
      stage: "authorized",
      capture: () => provider.capturePayment(ref),
      release: () => provider.cancelPayment(ref),
    });
  }
  // "succeeded" is only reported when Stripe says the payment is PAID
  // (a Checkout Session's payment_status, or the intent's status).
  if (state.status === "succeeded") return settleConfirmedPayment({ ...base, stage: "captured" });
  if (state.status === "canceled") {
    await closeAttempt(tenantId, "stripe", ref, "expired");
  }
  return { kind: "not_ready", status: state.status };
}

/**
 * Before a guest starts ANOTHER payment for an unpaid order (card again,
 * PayPal, the app's sheet), settle the Stripe payment already on it: if it
 * was authorized meanwhile it is captured now (when still acceptable) and
 * no second payment may start ("paid"); an open page is expired and its
 * attempt closed ("clear"). Without this, an old card tab stayed payable
 * for 24 h after the guest moved on (order O-6, 2026-10-19).
 *
 * `settle: false` (deleting an order): never capture — an authorized
 * payment is released instead, and the order is not paid on its way out.
 */
export async function releaseSupersededStripePayment(
  tenantId: string,
  orderId: string,
  options: { settle?: boolean } = {},
): Promise<"clear" | "paid" | "processing"> {
  const order = await asTenant(tenantId, (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: { paymentStatus: true, paymentProvider: true, paymentRef: true },
    }),
  );
  if (
    !order ||
    order.paymentProvider !== "stripe" ||
    !order.paymentRef ||
    (order.paymentStatus !== "pending" && order.paymentStatus !== "failed")
  ) {
    return "clear";
  }
  const ref = order.paymentRef;
  const provider = await tenantStripeProvider(tenantId);
  const state = await provider.retrievePaymentIntent(ref);
  // Unreadable on this account (e.g. a Connect-era ref): nothing we can
  // stop or settle from here.
  if (!state) return "clear";
  if (state.status === "processing") return "processing";
  if (
    options.settle !== false &&
    (state.status === "requires_capture" || state.status === "succeeded")
  ) {
    const done = await processStripeOrderPayment(tenantId, ref, { orderId, source: "switch" });
    if (done.kind === "settled" || (done.kind === "already_processed" && done.paid)) return "paid";
    if (done.kind === "needs_resolution") return "processing";
    return "clear"; // declined / released: the guest may pay again
  }
  if (state.status === "succeeded") return "paid"; // taken already; delete reports it
  if (!(await provider.cancelPayment(ref))) return "processing";
  await closeAttempt(tenantId, "stripe", ref, "cancelled");
  log.info("payment.superseded_released", { orderId, tenantId });
  return "clear";
}

export type VerifyPaymentResult =
  | { ok: true; paid: boolean; status: string }
  | { ok: false; error: "invalid_token" | "not_found" | "no_intent" | "not_available" };

/**
 * The pay page / app asks "is it paid yet?" — the server asks Stripe
 * itself (never the client's word) and settles through the same checks as
 * the webhook, so a venue whose webhook is down still gets its paid order
 * within seconds of the guest paying.
 */
export async function verifyOrderPayment(
  tenantId: string,
  orderId: string,
  token: string,
): Promise<VerifyPaymentResult> {
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId || verified.tenantId !== tenantId) {
    return { ok: false, error: "invalid_token" };
  }
  const order = await asTenant(tenantId, (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: { paymentStatus: true, paymentRef: true, paymentProvider: true },
    }),
  );
  if (!order) return { ok: false, error: "not_found" };
  if (order.paymentStatus === "paid") return { ok: true, paid: true, status: "succeeded" };
  if (order.paymentProvider !== "stripe" || !order.paymentRef) {
    return { ok: false, error: "no_intent" };
  }
  const done = await processStripeOrderPayment(tenantId, order.paymentRef, {
    orderId,
    source: "verify",
  });
  if (done.kind === "unreadable") return { ok: true, paid: false, status: "unknown" };
  if (done.kind === "not_ready") return { ok: true, paid: false, status: done.status };
  const paid = done.kind === "settled" || (done.kind === "already_processed" && done.paid);
  log.info("payment.verified", { orderId, tenantId, outcome: done.kind });
  return { ok: true, paid, status: paid ? "succeeded" : done.kind };
}

/** How far back the dashboard sweep looks. Past the 45-minute window a
 *  reserved payment is released rather than captured — the sweep keeps
 *  reconciling so nothing stays reserved or unexplained. */
const RECONCILE_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Owner-side sweep, run when the dashboard's Orders page loads: every
 * recent Stripe attempt still open is looked up at Stripe and processed
 * exactly like a webhook would (capture, release, expire). Bounded —
 * recent, capped — it is a page load, not a batch job. Returns how many
 * orders it settled.
 */
export async function reconcilePendingPayments(userId: string): Promise<number> {
  const since = new Date(Date.now() - RECONCILE_LOOKBACK_MS);
  const found = await asUser(userId, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({ select: { id: true } });
    const open = await tx.paymentAttempt.findMany({
      where: { provider: "stripe", status: "open", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { ref: true, orderId: true },
    });
    return { tenantId: tenant.id, open };
  });
  let settled = 0;
  for (const a of found.open) {
    const done = await processStripeOrderPayment(found.tenantId, a.ref, {
      orderId: a.orderId,
      source: "reconcile",
    }).catch(() => null);
    if (done?.kind === "settled") settled += 1;
  }
  if (settled > 0) log.info("payment.reconciled", { tenantId: found.tenantId, settled });
  return settled;
}

/**
 * The gateway says the payment did NOT go through (card declined, PayPal
 * capture denied). The order moves `pending → failed` so the guest sees
 * "Payment failed — try again / pay cash / cancel" instead of an endless
 * "pending"; it stays off the kitchen board. Only from `pending`: a paid
 * order is never downgraded by a late failure event for an older attempt,
 * and a retry that later succeeds settles it through `markOrderPaid`.
 */
export async function markOrderPaymentFailed(tenantId: string, orderId: string): Promise<boolean> {
  const updated = await asTenant(tenantId, (tx) =>
    tx.order.updateMany({
      where: { id: orderId, paymentStatus: "pending" },
      data: { paymentStatus: "failed" },
    }),
  );
  if (updated.count > 0) {
    log.info("payment.failed", { orderId, tenantId });
    void recordForOrder(tenantId, orderId, {
      kind: "payment.failed",
      actor: "system",
      summary: "Payment failed or was abandoned",
    });
  }
  return updated.count > 0;
}

export type GuestPaymentExitError =
  | "invalid_token"
  | "not_found"
  | "not_cancellable"
  | "already_paid"
  | "processing"
  | "cash_not_accepted";
export type GuestCancelResult = { ok: true } | { ok: false; error: GuestPaymentExitError };

/**
 * The ONLY way a guest can leave an online order: it must still be
 * `placed` (the kitchen has not started), its payment `pending` or
 * `failed`, on Stripe or PayPal. Cash orders never qualify — cash goes
 * straight to the kitchen and is the restaurant's to cancel.
 *
 * Money first. For Stripe we (1) ask Stripe whether it already
 * succeeded — then the order is settled and the guest is told it is paid,
 * and (2) cancel the PaymentIntent / expire the Checkout Session, so no
 * late payment can land on an order we are about to change. If Stripe
 * will not stop it (it is processing), we refuse. PayPal needs no call:
 * money moves only at capture, and neither capture path captures an order
 * that is cancelled or no longer on PayPal.
 */
async function releaseOnlinePayment(
  tenantId: string,
  orderId: string,
  token: string,
): Promise<{ ok: true } | { ok: false; error: GuestPaymentExitError }> {
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId || verified.tenantId !== tenantId) {
    return { ok: false, error: "invalid_token" };
  }
  const shared = await getStripeProvider();
  const looked = await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { status: true, paymentStatus: true, paymentProvider: true, paymentRef: true },
    });
    if (!order) return null;
    const tenant = await tx.tenant.findFirstOrThrow({
      select: { stripeOwnSecretEnc: true, stripeOwnWebhookEnc: true },
    });
    return { order, tenant };
  });
  if (!looked) return { ok: false, error: "not_found" };
  const { order, tenant } = looked;
  if (order.paymentStatus === "paid") return { ok: false, error: "already_paid" };
  const online =
    (order.paymentProvider === "stripe" || order.paymentProvider === "paypal") &&
    (order.paymentStatus === "pending" || order.paymentStatus === "failed");
  if (order.status !== "placed" || !online) return { ok: false, error: "not_cancellable" };

  if (order.paymentProvider === "stripe" && order.paymentRef) {
    const check = await verifyOrderPayment(tenantId, orderId, token);
    if (check.ok && check.paid) return { ok: false, error: "already_paid" };
    // Stopping the payment must work even with card payments switched
    // off in Billing — so the provider is chosen here from the keys alone,
    // not through selectDirectChargeProvider's on/off gate.
    const ownSecret = decryptSecret(tenant.stripeOwnSecretEnc);
    const provider = ownSecret
      ? await stripeProviderForKey(ownSecret, decryptSecret(tenant.stripeOwnWebhookEnc))
      : shared;
    if (!(await provider.cancelPayment(order.paymentRef))) {
      return { ok: false, error: "processing" };
    }
  }
  return { ok: true };
}

/** The guest calls off their unpaid online order. */
export async function cancelUnpaidOrderByGuest(
  tenantId: string,
  orderId: string,
  token: string,
): Promise<GuestCancelResult> {
  const released = await releaseOnlinePayment(tenantId, orderId, token);
  if (!released.ok) return released;

  const cancelled = await asTenant(tenantId, (tx) =>
    tx.order.updateMany({
      // Same guards again, inside the write: a webhook that settled the
      // order a moment ago wins, and so does a kitchen that just started it.
      where: {
        id: orderId,
        status: "placed",
        paymentStatus: { in: ["pending", "failed"] },
      },
      data: { status: "cancelled" },
    }),
  );
  if (cancelled.count === 0) return { ok: false, error: "not_cancellable" };
  log.info("order.cancelled_by_guest", { orderId, tenantId });
  void recordForOrder(tenantId, orderId, {
    kind: "order.cancelled",
    actor: "guest",
    summary: "Cancelled by the guest before paying",
  });

  // Undo whatever placing it moved (a redeemed loyalty voucher), exactly
  // as a kitchen cancel does. Idempotent; never blocks the answer.
  const { reverseOrderCredit } = await import("./loyalty-service");
  void reverseOrderCredit(tenantId, orderId).catch(() => undefined);
  return { ok: true };
}

/**
 * "Pay cash at the restaurant instead": the online payment is released
 * (see `releaseOnlinePayment`) and the order becomes a plain cash order —
 * which is what sends it to the kitchen. Offered only when the restaurant
 * lists cash among its accepted payments AND takes cash for this order
 * type (pickup / delivery can be card-or-PayPal only).
 *
 * Everything a cash order gets at placement happens now: the receipt,
 * the owner's e-mail and push alert (the kitchen's cue), exactly once.
 */
export async function switchUnpaidOrderToCash(
  tenantId: string,
  orderId: string,
  token: string,
): Promise<GuestCancelResult> {
  const accepts = await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { venueId: true, orderType: true, customerId: true, orderChannel: true },
    });
    if (!order) return null;
    const venue = await tx.venue.findFirst({
      where: { id: order.venueId },
      select: { ordering: true },
    });
    const { venueTakesCashFor } = await import("./ordering-config");
    return venueTakesCashFor(venue?.ordering, order.orderType, order);
  });
  if (accepts === null) return { ok: false, error: "not_found" };
  if (!accepts) return { ok: false, error: "cash_not_accepted" };

  const released = await releaseOnlinePayment(tenantId, orderId, token);
  if (!released.ok) return released;

  const switched = await asTenant(tenantId, async (tx) => {
    const res = await tx.order.updateMany({
      where: {
        id: orderId,
        status: "placed",
        paymentStatus: { in: ["pending", "failed"] },
      },
      data: { paymentStatus: "none", paymentProvider: null, paymentRef: null },
    });
    if (res.count === 0) return res;
    // A cash order now: it moves into the B series (owner, 2026-10-11). The
    // kitchen has not seen it yet — online orders reach the board only once
    // paid — so the new number is the first one anybody prints.
    const row = await tx.order.findFirst({
      where: { id: orderId },
      select: { venueId: true, orderSeries: true },
    });
    if (row && row.orderSeries === "O") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.venueId})::bigint)`;
      const { nextOrderNumber } = await import("./order-service");
      const orderNumber = await nextOrderNumber(tx, row.venueId, "B");
      await tx.order.update({ where: { id: orderId }, data: { orderSeries: "B", orderNumber } });
    }
    return res;
  });
  if (switched.count === 0) return { ok: false, error: "not_cancellable" };
  log.info("order.switched_to_cash", { orderId, tenantId });
  void recordForOrder(tenantId, orderId, {
    kind: "payment.switched_to_cash",
    actor: "guest",
    summary: "Guest chose to pay cash instead",
  });

  // Now it is a real order for the kitchen — same alerts a cash order
  // gets at placement. Fire-and-forget: a mail hiccup must not undo it.
  const { sendReceiptEmailForOrder } = await import("./receipt-email");
  void sendReceiptEmailForOrder(tenantId, orderId);
  const { sendNewOrderNotification } = await import("./order-notification");
  void sendNewOrderNotification(tenantId, orderId);
  const { sendNewOrderPush } = await import("./push-service");
  void sendNewOrderPush(tenantId, orderId);
  return { ok: true };
}

/**
 * What the guest's pay page may offer for this order: whether the
 * "payment not completed" choices apply at all (same conditions the two
 * actions enforce), and whether "pay cash instead" is one of them.
 */
export async function getGuestPaymentOptions(
  tenantId: string,
  orderId: string,
): Promise<{ status: string; canExit: boolean; acceptsCash: boolean } | null> {
  return asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        status: true,
        paymentStatus: true,
        paymentProvider: true,
        venueId: true,
        orderType: true,
        customerId: true,
        orderChannel: true,
      },
    });
    if (!order) return null;
    const venue = await tx.venue.findFirst({
      where: { id: order.venueId },
      select: { ordering: true },
    });
    const { venueTakesCashFor } = await import("./ordering-config");
    const canExit =
      order.status === "placed" &&
      (order.paymentProvider === "stripe" || order.paymentProvider === "paypal") &&
      (order.paymentStatus === "pending" || order.paymentStatus === "failed");
    return {
      status: order.status,
      canExit,
      acceptsCash: venueTakesCashFor(venue?.ordering, order.orderType, order),
    };
  });
}
