import Stripe from "stripe";
import { paymentWaitMessage, stripeCheckoutLocale } from "../payment-wait-copy";
import { checkoutExpiresAtSeconds } from "../payment-windows";
import type {
  CaptureResult,
  StripeCheckoutSessionRef,
  StripeCustomerRef,
  StripeEvent,
  StripePortalSessionRef,
  StripeProvider,
  StripeSubscriptionSummary,
  ConnectAccountRef,
  ConnectAccountStatus,
  ConnectOnboardingLink,
  OrderCheckoutRef,
  PaymentIntentRef,
  PaymentIntentState,
} from "./provider";

/**
 * Real Stripe SDK wrapper. Only imported when both `STRIPE_SECRET_KEY`
 * and `STRIPE_WEBHOOK_SECRET` are present in env — otherwise we run on
 * the fake (see `./index.ts`).
 *
 * SDK version: pinned by `pnpm add stripe` at 22.x; the `apiVersion` is
 * an explicit `null` so the SDK uses the key's default. Bump both
 * together when we go for a scheduled Stripe API upgrade.
 */
export class RealStripeProvider implements StripeProvider {
  readonly mode = "real";
  private readonly stripe: Stripe;
  private readonly webhookSecrets: string[];

  constructor(secretKey: string, webhookSecret: string, connectWebhookSecret?: string) {
    this.stripe = new Stripe(secretKey);
    this.webhookSecrets = connectWebhookSecret
      ? [webhookSecret, connectWebhookSecret]
      : [webhookSecret];
  }

  async createCustomer(input: { email: string; tenantId: string }): Promise<StripeCustomerRef> {
    const c = await this.stripe.customers.create({
      email: input.email,
      metadata: { tenantId: input.tenantId },
    });
    return { id: c.id };
  }

  async createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    tenantId: string;
    planCode: string;
  }): Promise<StripeCheckoutSessionRef> {
    // tenantId/planCode metadata goes on BOTH the session (read by
    // checkout.session.completed) and the subscription it spawns (read
    // by customer.subscription.* and, via subscription_details, by
    // invoice.* events). Without it the webhook handler cannot resolve
    // the tenant and skips the event.
    const metadata = { tenantId: input.tenantId, planCode: input.planCode };
    const session = await this.stripe.checkout.sessions.create({
      customer: input.customerId,
      mode: "subscription",
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      subscription_data: {
        metadata,
        ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
      },
      // Payment method optional during trial so guests can commit before
      // handing over a card (roadmap §12).
      payment_method_collection: input.trialDays ? "if_required" : "always",
    });
    if (!session.url) throw new Error("Stripe returned a session without a URL");
    return { id: session.id, url: session.url };
  }

  async createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<StripePortalSessionRef> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  async retrieveSubscription(id: string): Promise<StripeSubscriptionSummary | null> {
    try {
      const s = await this.stripe.subscriptions.retrieve(id);
      // `current_period_end` and friends are unix seconds in the SDK
      // shape — normalise to Date at the seam so callers don't ever
      // see raw epoch numbers.
      const cast = s as unknown as {
        id: string;
        customer: string;
        status: string;
        current_period_end?: number;
        trial_end?: number | null;
        cancel_at?: number | null;
        items: { data: { price: { id: string }; current_period_end?: number }[] };
      };
      // API versions ≥2025 (Basil) moved current_period_end from the
      // subscription onto each subscription item — read both homes.
      const periodEnd = cast.current_period_end ?? cast.items.data[0]?.current_period_end;
      return {
        id: cast.id,
        customerId: cast.customer,
        status: cast.status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        trialEnd: cast.trial_end ? new Date(cast.trial_end * 1000) : null,
        cancelAt: cast.cancel_at ? new Date(cast.cancel_at * 1000) : null,
        planPriceId: cast.items.data[0]?.price.id ?? null,
      };
    } catch (err) {
      if (
        err instanceof Stripe.errors.StripeInvalidRequestError &&
        err.code === "resource_missing"
      ) {
        return null;
      }
      throw err;
    }
  }

  constructWebhookEvent(body: string, signatureHeader: string): StripeEvent {
    // Account and Connect endpoints carry different signing secrets in
    // production — accept whichever verifies. Throws (→ 400) only when
    // no configured secret matches.
    let event: import("stripe").Stripe.Event | null = null;
    let lastError: unknown = null;
    for (const secret of this.webhookSecrets) {
      try {
        event = this.stripe.webhooks.constructEvent(body, signatureHeader, secret);
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!event) throw lastError instanceof Error ? lastError : new Error("signature mismatch");
    return {
      id: event.id,
      type: event.type,
      data: { object: event.data.object },
      livemode: event.livemode,
      createdAt: new Date(event.created * 1000),
    };
  }

  /* ---- Connect (guest payments). UNTESTED against live Stripe until
     the P0-11 key gate opens — shapes follow the official docs for
     Express accounts + destination charges via Checkout. ---- */

  async createConnectAccount(input: {
    tenantId: string;
    email: string;
  }): Promise<ConnectAccountRef> {
    const account = await this.stripe.accounts.create({
      type: "express",
      email: input.email,
      metadata: { tenantId: input.tenantId },
      // Direct charges on the connected account REQUIRE these two
      // capabilities to be requested explicitly — without them Stripe
      // rejects every checkout with "cannot create a charge … without
      // the card_payments capability".
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    return { id: account.id };
  }

  async createConnectOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<ConnectOnboardingLink> {
    const link = await this.stripe.accountLinks.create({
      account: input.accountId,
      type: "account_onboarding",
      return_url: input.returnUrl,
      refresh_url: input.refreshUrl,
    });
    return { url: link.url };
  }

  async getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    const account = await this.stripe.accounts.retrieve(accountId);
    return { chargesEnabled: Boolean(account.charges_enabled) };
  }

  async createOrderCheckout(input: {
    accountId: string;
    orderId: string;
    tenantId: string;
    amountCents: number;
    feeCents: number;
    currency: string;
    label: string;
    successUrl: string;
    cancelUrl: string;
    payPageUrl: string;
    locale?: string | null;
  }): Promise<OrderCheckoutRef> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountCents,
              product_data: { name: input.label },
            },
          },
        ],
        payment_intent_data: { application_fee_amount: input.feeCents },
        expires_at: checkoutExpiresAtSeconds(),
        metadata: { orderId: input.orderId, tenantId: input.tenantId },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        locale: stripeCheckoutLocale(input.locale),
        custom_text: { submit: { message: paymentWaitMessage(input.locale) } },
      },
      { stripeAccount: input.accountId },
    );
    return { ref: session.id, url: session.url ?? input.cancelUrl };
  }

  async createDirectCheckout(input: {
    orderId: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    label: string;
    successUrl: string;
    cancelUrl: string;
    payPageUrl: string;
    locale?: string | null;
  }): Promise<OrderCheckoutRef> {
    // No stripeAccount header + no application fee: this client IS the
    // restaurant's own account, so the charge settles 100% to them.
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: { name: input.label },
          },
        },
      ],
      metadata: { orderId: input.orderId, tenantId: input.tenantId },
      // Authorize only: the card is reserved, and the money moves when the
      // server captures it after checking the order is still wanted, unpaid
      // and within the 45-minute window (payment-settlement.ts). Otherwise
      // the reservation is released and the guest is never charged.
      // NO orderId metadata on the intent (production bug, 2026-10-21):
      // the order's payment is the SESSION (cs_…); intent events carrying
      // the order id were processed under the pi_… ref, which matches no
      // attempt, and that path released — cancelled — the guest's payment
      // a moment before the session event captured it. Session events are
      // the web flow's only trigger.
      payment_intent_data: { capture_method: "manual" },
      // Payable for 30 minutes, not Stripe's default 24 hours.
      expires_at: checkoutExpiresAtSeconds(),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // The guest's language, and the "don't close this window" line next
      // to Stripe's Pay button (owner, 2026-10-19).
      locale: stripeCheckoutLocale(input.locale),
      custom_text: { submit: { message: paymentWaitMessage(input.locale) } },
    });
    return { ref: session.id, url: session.url ?? input.cancelUrl };
  }

  async createDirectPaymentIntent(input: {
    orderId?: string;
    giftCardId?: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    label: string;
  }): Promise<PaymentIntentRef> {
    // Same posture as createDirectCheckout: no `stripeAccount` header and
    // no application fee, because this client IS the restaurant's account.
    // `automatic_payment_methods` lets Stripe decide what the sheet offers
    // (cards, Apple Pay, Google Pay, local methods) from the account's own
    // Dashboard settings, so adding a method never needs an app release.
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      // An order is authorized only and captured by the server after its
      // checks (as on the web); a gift card is a plain sale, taken at once.
      capture_method: input.orderId && !input.giftCardId ? "manual" : "automatic",
      description: input.label,
      // Exactly one of orderId / giftCardId, as distinct keys — the
      // webhook branches on which is present, so a gift-card purchase can
      // never be settled down the order path or the reverse.
      metadata: input.giftCardId
        ? { giftCardId: input.giftCardId, tenantId: input.tenantId }
        : { orderId: input.orderId ?? "", tenantId: input.tenantId },
    });
    if (!intent.client_secret) {
      throw new Error("Stripe returned a PaymentIntent without a client secret");
    }
    return { ref: intent.id, clientSecret: intent.client_secret };
  }

  async retrievePaymentIntent(ref: string): Promise<PaymentIntentState | null> {
    try {
      if (ref.startsWith("cs_")) {
        // A web order's ref is its Checkout Session, not an intent: read
        // the session (and its intent) so verify / reconcile / the payment
        // switch see what the webhook may never have delivered (O-6).
        const session = await this.stripe.checkout.sessions.retrieve(ref, {
          expand: ["payment_intent.latest_charge"],
        });
        const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
        const status =
          session.payment_status === "paid"
            ? "succeeded"
            : pi?.status === "requires_capture"
              ? "requires_capture"
              : session.status === "expired" || pi?.status === "canceled"
                ? "canceled"
                : session.status === "complete"
                  ? "processing"
                  : "requires_payment_method";
        return {
          status,
          amountCents:
            pi?.status === "requires_capture" ? pi.amount_capturable : (session.amount_total ?? 0),
          currency: (session.currency ?? "").toUpperCase(),
          authorizedAt: authorizedAtOf(pi),
        };
      }
      const pi = await this.stripe.paymentIntents.retrieve(ref, { expand: ["latest_charge"] });
      if (pi.status === "requires_capture") {
        return {
          status: pi.status,
          amountCents: pi.amount_capturable,
          currency: pi.currency.toUpperCase(),
          authorizedAt: authorizedAtOf(pi),
        };
      }
      return {
        status: pi.status,
        amountCents: pi.amount,
        currency: pi.currency.toUpperCase(),
        authorizedAt: authorizedAtOf(pi),
      };
    } catch {
      // Unknown id on this account (or the wrong account's key): the caller
      // treats it as "cannot confirm", never as paid.
      return null;
    }
  }

  async paymentMethodOf(ref: string): Promise<string | null> {
    try {
      let intent: Stripe.PaymentIntent | null;
      if (ref.startsWith("cs_")) {
        const session = await this.stripe.checkout.sessions.retrieve(ref, {
          expand: ["payment_intent.payment_method"],
        });
        intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
      } else {
        intent = await this.stripe.paymentIntents.retrieve(ref, { expand: ["payment_method"] });
      }
      const method = intent?.payment_method;
      if (!method || typeof method === "string") return null;
      return method.card?.wallet?.type ?? method.type ?? null;
    } catch {
      return null;
    }
  }

  async capturePayment(ref: string): Promise<CaptureResult> {
    try {
      let piId = ref;
      if (ref.startsWith("cs_")) {
        const session = await this.stripe.checkout.sessions.retrieve(ref);
        const id =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
        if (!id) return { captured: false, amountCents: 0, currency: "" };
        piId = id;
      }
      let pi = await this.stripe.paymentIntents.retrieve(piId);
      if (pi.status === "requires_capture") {
        // The idempotency key makes a retried capture (webhook retry, two
        // paths racing) a single capture on Stripe's side too.
        pi = await this.stripe.paymentIntents.capture(
          piId,
          {},
          { idempotencyKey: `capture-${piId}` },
        );
      }
      return pi.status === "succeeded"
        ? { captured: true, amountCents: pi.amount_received, currency: pi.currency.toUpperCase() }
        : { captured: false, amountCents: 0, currency: pi.currency.toUpperCase() };
    } catch {
      return { captured: false, amountCents: 0, currency: "" };
    }
  }

  async cancelPayment(ref: string): Promise<boolean> {
    try {
      if (ref.startsWith("cs_")) {
        const session = await this.stripe.checkout.sessions.retrieve(ref, {
          expand: ["payment_intent"],
        });
        if (session.status === "open") {
          await this.stripe.checkout.sessions.expire(ref);
          return true;
        }
        if (session.status === "expired") return true;
        // Complete: only an uncaptured reservation can still be released.
        const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
        if (pi?.status === "requires_capture") {
          await this.stripe.paymentIntents.cancel(pi.id);
          return true;
        }
        return pi?.status === "canceled";
      }
      const pi = await this.stripe.paymentIntents.retrieve(ref);
      if (pi.status === "canceled") return true;
      if (pi.status === "succeeded" || pi.status === "processing") return false;
      await this.stripe.paymentIntents.cancel(ref);
      return true;
    } catch {
      // Stripe refused (e.g. it moved to processing a moment ago) or the
      // ref is unreadable: report "not stopped" so nothing is cancelled
      // on our side on a guess.
      return false;
    }
  }
}

/**
 * When the guest authorized: the creation time of the intent's charge
 * (Stripe creates it when the card is reserved). Null when there is none
 * yet or it was not expanded.
 */
function authorizedAtOf(pi: Stripe.PaymentIntent | null): Date | null {
  const charge = pi?.latest_charge;
  if (!charge || typeof charge === "string") return null;
  return new Date(charge.created * 1000);
}
