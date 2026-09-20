/**
 * StripeProvider is the seam every billing call site talks to. In prod
 * it wraps the real `stripe` SDK; in dev + tests it's an in-memory fake
 * that signs webhook payloads with the same HMAC format Stripe uses, so
 * the webhook route (P1-19c) doesn't need a live Stripe account to be
 * exercised end-to-end.
 *
 * Only the methods P1-19 actually needs are on the interface: adding
 * more is one edit here plus one in each implementation.
 */

export interface StripeCustomerRef {
  id: string;
}

export interface StripeCheckoutSessionRef {
  id: string;
  url: string;
}

export interface StripePortalSessionRef {
  url: string;
}

export interface StripeSubscriptionSummary {
  id: string;
  customerId: string;
  status: string;
  currentPeriodEnd?: Date | null;
  trialEnd?: Date | null;
  cancelAt?: Date | null;
  planPriceId?: string | null;
}

/**
 * Minimal shape used by the webhook route. Match Stripe's SDK naming so
 * a caller can move to the real SDK's `Stripe.Event` type by renaming
 * the import, not the fields.
 */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
  livemode?: boolean;
  createdAt?: Date;
}

export interface ConnectAccountRef {
  id: string;
}

export interface ConnectOnboardingLink {
  url: string;
}

export interface ConnectAccountStatus {
  chargesEnabled: boolean;
}

export interface OrderCheckoutRef {
  /** Where the guest goes to pay. Real: Stripe-hosted checkout on the
   *  connected account. Fake: the local /pay page. */
  url: string;
  ref: string;
}

export interface PaymentIntentRef {
  /** The PaymentIntent id — stored on the order as `paymentRef`, exactly
   *  like a checkout session id, so settlement is ref-shaped either way. */
  ref: string;
  /** Handed to the mobile app's native PaymentSheet. Useless without the
   *  matching publishable key, and scoped to this one intent. */
  clientSecret: string;
}

export interface StripeProvider {
  readonly mode: "real" | "fake";

  createCustomer(input: { email: string; tenantId: string }): Promise<StripeCustomerRef>;

  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    /** Stamped as metadata on both the session and the subscription it
     *  creates — the webhook handler resolves the tenant from these and
     *  silently skips events without them. */
    tenantId: string;
    planCode: string;
  }): Promise<StripeCheckoutSessionRef>;

  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<StripePortalSessionRef>;

  retrieveSubscription(id: string): Promise<StripeSubscriptionSummary | null>;

  /**
   * Verify Stripe's `Stripe-Signature` header against `body` (the raw
   * request body, not JSON.parsed). Throws or returns null on any
   * signature failure — never returns a partial parse.
   */
  constructWebhookEvent(body: string, signatureHeader: string): StripeEvent;

  /* ---- Connect (guest payments, P6) ---- */

  /** Create the restaurant's connected account (Express). */
  createConnectAccount(input: { tenantId: string; email: string }): Promise<ConnectAccountRef>;

  /** Hosted onboarding link — Stripe collects bank details + KYC. */
  createConnectOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<ConnectOnboardingLink>;

  getConnectAccountStatus(accountId: string): Promise<ConnectAccountStatus>;

  /** Checkout for one order on the connected account. The application
   *  fee is Guesto's cut; the rest settles to the restaurant. */
  createOrderCheckout(input: {
    accountId: string;
    orderId: string;
    tenantId: string;
    amountCents: number;
    feeCents: number;
    currency: string;
    label: string;
    successUrl: string;
    cancelUrl: string;
    /** Local fake-pay page; the fake provider sends the guest here, the
     *  real provider ignores it (Stripe hosts the payment page). */
    payPageUrl: string;
  }): Promise<OrderCheckoutRef>;

  /** Checkout for one order on THIS provider's own account — no connected
   *  account, no application fee (own-keys / flat-fee plan: the restaurant
   *  keeps 100%). Used with a provider built from the restaurant's own key. */
  createDirectCheckout(input: {
    orderId: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    label: string;
    successUrl: string;
    cancelUrl: string;
    payPageUrl: string;
  }): Promise<OrderCheckoutRef>;

  /** The native-payment-sheet sibling of `createDirectCheckout`: a bare
   *  PaymentIntent on THIS provider's own account (no connected account,
   *  no application fee), whose client secret the mobile app confirms
   *  in-process instead of bouncing the guest to a hosted page. Same
   *  `metadata.orderId/tenantId` contract, so the webhook settles it the
   *  same way — `payment_intent.succeeded` rather than
   *  `checkout.session.completed`. */
  createDirectPaymentIntent(input: {
    /**
     * What is being paid for. Exactly one of these is set: an ORDER (the
     * original caller) or a GIFT CARD purchase, which is a sale of
     * stored value with no order behind it. They are stamped as distinct
     * metadata keys rather than one polymorphic id, so the webhook can
     * never settle a gift card as if it were an order — the two have
     * completely different side effects (a kitchen ticket vs. a card the
     * guest can spend for three years).
     */
    orderId?: string;
    giftCardId?: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    label: string;
  }): Promise<PaymentIntentRef>;

  /** Ask Stripe what became of a PaymentIntent. The app calls this path
   *  (via /pay/verify) right after its sheet succeeds, so a missing or
   *  late webhook never leaves a charged guest looking unpaid. Null when
   *  the ref is unknown. */
  retrievePaymentIntent(ref: string): Promise<PaymentIntentState | null>;
}

export interface PaymentIntentState {
  /** Stripe's status string — "succeeded" is the only one that settles. */
  status: string;
  amountCents: number;
  /** ISO code, upper-case. */
  currency: string;
}
