import Stripe from "stripe";
import type {
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
        metadata: { orderId: input.orderId, tenantId: input.tenantId },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
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
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    return { ref: session.id, url: session.url ?? input.cancelUrl };
  }

  async createDirectPaymentIntent(input: {
    orderId: string;
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
      description: input.label,
      metadata: { orderId: input.orderId, tenantId: input.tenantId },
    });
    if (!intent.client_secret) {
      throw new Error("Stripe returned a PaymentIntent without a client secret");
    }
    return { ref: intent.id, clientSecret: intent.client_secret };
  }
}
