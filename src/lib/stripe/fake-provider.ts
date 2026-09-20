import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
  PaymentIntentState,
} from "./provider";

/**
 * In-memory Stripe stand-in used everywhere the real SDK would need a
 * live account. Deterministic-enough for tests: IDs are UUIDs (unique
 * per call), but any test that needs a stable payload can sign the
 * event it wants via `signWebhook`.
 *
 * Signature format matches Stripe's real header verbatim
 * (`t=<unix>,v1=<hex-hmac>` over `${timestamp}.${body}`), so P1-19c's
 * webhook route can flip between real + fake with no code change.
 */
export class FakeStripeProvider implements StripeProvider {
  readonly mode = "fake";
  private readonly customers = new Map<string, StripeCustomerRef & { email: string }>();
  private readonly subscriptions = new Map<string, StripeSubscriptionSummary>();
  private readonly connectAccounts = new Map<
    string,
    { tenantId: string; chargesEnabled: boolean }
  >();
  private readonly orderCheckouts = new Map<
    string,
    {
      /** "" for a gift-card purchase, which has no order behind it. */
      orderId: string;
      giftCardId?: string;
      tenantId: string;
      amountCents: number;
      feeCents: number;
      paid: boolean;
      currency?: string;
    }
  >();

  constructor(private readonly webhookSecret: string) {}

  async createCustomer(input: { email: string; tenantId: string }): Promise<StripeCustomerRef> {
    const id = `cus_fake_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const rec = { id, email: input.email };
    this.customers.set(id, rec);
    return { id };
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
    const id = `cs_fake_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    // No-op — the fake session's URL wouldn't actually accept a card. Tests
    // that need "the user completed checkout" call `signWebhook` directly.
    void input;
    return { id, url: `https://fake-stripe.local/checkout/${id}` };
  }

  async createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<StripePortalSessionRef> {
    return {
      url: `https://fake-stripe.local/portal/${input.customerId}?return=${encodeURIComponent(input.returnUrl)}`,
    };
  }

  async retrieveSubscription(id: string): Promise<StripeSubscriptionSummary | null> {
    return this.subscriptions.get(id) ?? null;
  }

  /**
   * Verify + parse in one step. Recomputes the HMAC over
   * `${timestamp}.${body}` and rejects any mismatch or malformed header.
   */
  constructWebhookEvent(body: string, signatureHeader: string): StripeEvent {
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((kv) => {
        const idx = kv.indexOf("=");
        return [kv.slice(0, idx), kv.slice(idx + 1)];
      }),
    );
    const t = parts.t;
    const sig = parts.v1;
    if (!t || !sig) throw new Error("Invalid Stripe-Signature header shape");

    const expected = createHmac("sha256", this.webhookSecret).update(`${t}.${body}`).digest("hex");
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Stripe-Signature mismatch");
    }

    const parsed = JSON.parse(body) as StripeEvent;
    if (!parsed.id || !parsed.type || !parsed.data) {
      throw new Error("Malformed webhook payload");
    }
    return parsed;
  }

  // ---------- test helpers (not on the interface) ----------

  /**
   * Sign a webhook payload the way Stripe itself does. Returns `{body,
   * header}` — pass them to `constructWebhookEvent` or the webhook route.
   * Tests use this to fabricate `checkout.session.completed` etc.
   */
  signWebhook(
    event: StripeEvent,
    atSeconds = Math.floor(Date.now() / 1000),
  ): {
    body: string;
    header: string;
  } {
    const body = JSON.stringify(event);
    const sig = createHmac("sha256", this.webhookSecret)
      .update(`${atSeconds}.${body}`)
      .digest("hex");
    return { body, header: `t=${atSeconds},v1=${sig}` };
  }

  /** Seed a subscription so `retrieveSubscription` returns it. */
  seedSubscription(summary: StripeSubscriptionSummary): void {
    this.subscriptions.set(summary.id, summary);
  }

  /* ---- Connect (guest payments) ---- */

  async createConnectAccount(input: {
    tenantId: string;
    email: string;
  }): Promise<ConnectAccountRef> {
    const id = `acct_fake_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    this.connectAccounts.set(id, { tenantId: input.tenantId, chargesEnabled: false });
    return { id };
  }

  async createConnectOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<ConnectOnboardingLink> {
    // The fake "completes onboarding" instantly: charges flip on and the
    // owner bounces straight back to returnUrl — the closest analogue of
    // Stripe's hosted flow without leaving dev.
    const acct = this.connectAccounts.get(input.accountId);
    if (acct) acct.chargesEnabled = true;
    return { url: input.returnUrl };
  }

  async getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
    return { chargesEnabled: this.connectAccounts.get(accountId)?.chargesEnabled ?? false };
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
    const ref = `pi_fake_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    this.orderCheckouts.set(ref, {
      orderId: input.orderId,
      tenantId: input.tenantId,
      amountCents: input.amountCents,
      feeCents: input.feeCents,
      paid: false,
    });
    const sep = input.payPageUrl.includes("?") ? "&" : "?";
    return { ref, url: `${input.payPageUrl}${sep}ref=${ref}` };
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
    // Own-keys, no platform fee — tracked like any fake checkout so the
    // local /pay page + confirm route settle it.
    const ref = `pi_own_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    this.orderCheckouts.set(ref, {
      orderId: input.orderId,
      tenantId: input.tenantId,
      amountCents: input.amountCents,
      feeCents: 0,
      paid: false,
    });
    const sep = input.payPageUrl.includes("?") ? "&" : "?";
    return { ref, url: `${input.payPageUrl}${sep}ref=${ref}` };
  }

  async createDirectPaymentIntent(input: {
    orderId?: string;
    giftCardId?: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    label: string;
  }): Promise<PaymentIntentRef> {
    // Registered in the SAME map as the fake checkouts, so `/pay/confirm`
    // and `settleOrderCheckout` settle an intent with no extra branch —
    // the app's dev/demo "pay" button lands exactly where the web one does.
    const ref = `pi_fake_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    this.orderCheckouts.set(ref, {
      orderId: input.orderId ?? "",
      giftCardId: input.giftCardId,
      tenantId: input.tenantId,
      amountCents: input.amountCents,
      feeCents: 0,
      paid: false,
      currency: input.currency.toUpperCase(),
    });
    return { ref, clientSecret: `${ref}_secret_test` };
  }

  async retrievePaymentIntent(ref: string): Promise<PaymentIntentState | null> {
    const c = this.orderCheckouts.get(ref);
    if (!c) return null;
    return {
      status: c.paid ? "succeeded" : "requires_payment_method",
      amountCents: c.amountCents,
      currency: c.currency ?? "EUR",
    };
  }

  /** Test/dev hook: settle a fake checkout, like Stripe's webhook would. */
  settleOrderCheckout(
    ref: string,
  ): { orderId: string; tenantId: string; giftCardId?: string } | null {
    const c = this.orderCheckouts.get(ref);
    if (!c || c.paid) return null;
    c.paid = true;
    // `giftCardId` is only spread in when set, so the order case keeps
    // its exact historical shape and the existing assertions on it hold.
    return {
      orderId: c.orderId,
      tenantId: c.tenantId,
      ...(c.giftCardId ? { giftCardId: c.giftCardId } : {}),
    };
  }
}
