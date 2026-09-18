import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * PayPal — the restaurant's OWN business account, single-merchant
 * checkout (Orders v2, redirect/approve flow — deliberately NO PayPal
 * JS SDK). Same posture as the Stripe seam: unset credentials → the
 * in-memory fake drives every codepath in dev/CI; set PAYPAL_CLIENT_ID
 * + PAYPAL_CLIENT_SECRET (sandbox first, per PAYPAL_ENV) and the real
 * REST wrapper takes over with zero code changes.
 */

export interface PayPalApproval {
  /** Where to send the guest (PayPal's approve page; the fake short-circuits home). */
  url: string;
  /** PayPal order id — stored as the order's paymentRef. */
  ref: string;
}

export interface PayPalProvider {
  mode: "fake" | "sandbox" | "live";
  createOrderApproval(input: {
    tenantId: string;
    orderId: string;
    amountCents: number;
    currency: string;
    label: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<PayPalApproval>;
  /** Capture an approved order. Idempotent: already-captured counts as paid. */
  captureOrder(ref: string): Promise<{ paid: boolean }>;
  /**
   * Is this webhook delivery genuinely from PayPal, for the endpoint
   * registered as `webhookId`? PayPal has no shared HMAC secret — the
   * real provider asks PayPal's verify-webhook-signature API; the fake
   * checks an HMAC keyed on the webhook id so tests can sign payloads.
   */
  verifyWebhookSignature(input: PayPalWebhookVerifyInput): Promise<boolean>;
}

export interface PayPalWebhookVerifyInput {
  /** Exact bytes of the request body — verification is over the wire form. */
  rawBody: string;
  headers: PayPalWebhookHeaders;
  webhookId: string;
}

/** The five `paypal-*` headers PayPal sends with every webhook delivery. */
export interface PayPalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

/* ------------------------------------------------------------------ */
/* Fake — dev/CI. The approve URL bounces straight to the return leg,  */
/* so the whole guest flow stays clickable without a PayPal account.   */
/* ------------------------------------------------------------------ */

class FakePayPalProvider implements PayPalProvider {
  mode = "fake" as const;
  private created = new Set<string>();

  async createOrderApproval(input: {
    orderId: string;
    returnUrl: string;
  }): Promise<PayPalApproval> {
    const ref = `pp_fake_${input.orderId}`;
    this.created.add(ref);
    const sep = input.returnUrl.includes("?") ? "&" : "?";
    return { url: `${input.returnUrl}${sep}ppfake=1`, ref };
  }

  async captureOrder(ref: string): Promise<{ paid: boolean }> {
    // Refs the fake never issued fail, like a bogus capture would.
    return { paid: ref.startsWith("pp_fake_") };
  }

  async verifyWebhookSignature(input: PayPalWebhookVerifyInput): Promise<boolean> {
    const expected = fakeWebhookSignature(input.webhookId, input.rawBody);
    const a = Buffer.from(input.headers.transmissionSig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  }
}

/**
 * The fake's stand-in for PayPal's signature: HMAC-SHA256 over the raw
 * body keyed on the webhook id. Exported so tests can sign a payload
 * exactly the way the fake verifies it.
 */
export function fakeWebhookSignature(webhookId: string, rawBody: string): string {
  return createHmac("sha256", webhookId).update(rawBody).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Real — plain fetch against PayPal REST (no SDK dependency).         */
/* ------------------------------------------------------------------ */

class RealPayPalProvider implements PayPalProvider {
  mode: "sandbox" | "live";
  private base: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private clientId: string,
    private clientSecret: string,
    envName: "sandbox" | "live",
  ) {
    this.mode = envName;
    this.base =
      envName === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`paypal oauth ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  async createOrderApproval(input: {
    tenantId: string;
    orderId: string;
    amountCents: number;
    currency: string;
    label: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<PayPalApproval> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.orderId,
            // PayPal echoes custom_id on the order AND on every capture it
            // creates for it, so both CHECKOUT.ORDER.* and PAYMENT.CAPTURE.*
            // webhooks can name our tenant + order (the PayPal sibling of
            // Stripe's metadata.tenantId). 127-char limit; two cuids fit.
            custom_id: payPalCustomId(input.tenantId, input.orderId),
            description: input.label.slice(0, 127),
            amount: {
              currency_code: input.currency.toUpperCase(),
              value: (input.amountCents / 100).toFixed(2),
            },
          },
        ],
        application_context: {
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
        },
      }),
    });
    if (!res.ok) {
      log.error("paypal.create_failed", { status: res.status, body: await res.text() });
      throw new Error(`paypal create ${res.status}`);
    }
    const body = (await res.json()) as {
      id: string;
      links?: { rel: string; href: string }[];
    };
    const approve = body.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
    if (!approve) throw new Error("paypal create: no approve link");
    return { url: approve.href, ref: body.id };
  }

  async captureOrder(ref: string): Promise<{ paid: boolean }> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base}/v2/checkout/orders/${encodeURIComponent(ref)}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 422) {
      // ORDER_ALREADY_CAPTURED — a double return leg. Idempotent success.
      const body = await res.text();
      if (body.includes("ORDER_ALREADY_CAPTURED")) return { paid: true };
      log.warn("paypal.capture_422", { ref, body });
      return { paid: false };
    }
    if (!res.ok) {
      log.error("paypal.capture_failed", { ref, status: res.status });
      return { paid: false };
    }
    const body = (await res.json()) as { status?: string };
    return { paid: body.status === "COMPLETED" };
  }

  async verifyWebhookSignature(input: PayPalWebhookVerifyInput): Promise<boolean> {
    const token = await this.accessToken();
    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(input.rawBody);
    } catch {
      return false;
    }
    const res = await fetch(`${this.base}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: input.headers.authAlgo,
        cert_url: input.headers.certUrl,
        transmission_id: input.headers.transmissionId,
        transmission_sig: input.headers.transmissionSig,
        transmission_time: input.headers.transmissionTime,
        webhook_id: input.webhookId,
        webhook_event: webhookEvent,
      }),
    });
    if (!res.ok) {
      log.warn("paypal.webhook_verify_failed", { status: res.status });
      return false;
    }
    const body = (await res.json()) as { verification_status?: string };
    return body.verification_status === "SUCCESS";
  }
}

/** `custom_id` we stamp on PayPal orders: "<tenantId>:<orderId>". */
export function payPalCustomId(tenantId: string, orderId: string): string {
  return `${tenantId}:${orderId}`;
}

/** Inverse of payPalCustomId; null for anything we did not stamp. */
export function parsePayPalCustomId(
  customId: string | null | undefined,
): { tenantId: string; orderId: string } | null {
  if (!customId) return null;
  const idx = customId.indexOf(":");
  if (idx <= 0 || idx === customId.length - 1) return null;
  return { tenantId: customId.slice(0, idx), orderId: customId.slice(idx + 1) };
}

/* ------------------------------------------------------------------ */
/* Selector                                                            */
/* ------------------------------------------------------------------ */

let cached: PayPalProvider | null = null;

export function getPayPalProvider(): PayPalProvider {
  if (cached) return cached;
  cached =
    env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET
      ? new RealPayPalProvider(env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET, env.PAYPAL_ENV)
      : new FakePayPalProvider();
  if (cached.mode === "fake" && env.NODE_ENV === "production") {
    log.warn("paypal.fake_in_production", {});
  }
  return cached;
}

/**
 * Provider for ONE restaurant: its own dashboard-entered credentials win,
 * the deployment-wide PAYPAL_* env vars are the fallback. Not cached —
 * credentials are per tenant and can change from the dashboard at any time.
 */
export function payPalProviderFor(credentials: {
  clientId: string | null;
  secret: string | null;
  env: "sandbox" | "live";
  enabled: boolean;
}): PayPalProvider {
  if (credentials.enabled && credentials.clientId && credentials.secret) {
    return new RealPayPalProvider(credentials.clientId, credentials.secret, credentials.env);
  }
  return getPayPalProvider();
}

/** Guests may be offered PayPal: real credentials, or the fake outside prod. */
/** Is PayPal offerable at all? True when the deployment has env keys, or
 *  in non-production where the in-memory fake stands in. A restaurant that
 *  saved only its OWN keys passes via `tenantHasOwnKeys`. */
export function paypalAvailable(tenantHasOwnKeys = false): boolean {
  if (tenantHasOwnKeys) return true;
  const provider = getPayPalProvider();
  return provider.mode !== "fake" || env.NODE_ENV !== "production";
}
