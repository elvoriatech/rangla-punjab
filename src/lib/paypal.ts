import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { createLogger } from "./logger";
import { payPalEnvUsableHere } from "./live-key-guard";

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
  /** Capture an approved order. Idempotent: already-captured counts as
   *  paid. Reports what was actually taken (0 / "" when not paid). */
  captureOrder(ref: string): Promise<PayPalCapture>;
  /** The order as PayPal holds it now: CREATED (guest not done), APPROVED
   *  (guest approved — money not moved), COMPLETED (captured), VOIDED…;
   *  with when the guest approved and what was captured. Null when PayPal
   *  does not know it on this account. */
  getOrderState(ref: string): Promise<PayPalOrderState | null>;
  /**
   * Is this webhook delivery genuinely from PayPal, for the endpoint
   * registered as `webhookId`? PayPal has no shared HMAC secret — the
   * real provider asks PayPal's verify-webhook-signature API; the fake
   * checks an HMAC keyed on the webhook id so tests can sign payloads.
   */
  verifyWebhookSignature(input: PayPalWebhookVerifyInput): Promise<boolean>;
}

export interface PayPalOrderState {
  status: string;
  approvedAt: Date | null;
  capture: PayPalCapture;
}

export interface PayPalCapture {
  paid: boolean;
  amountCents: number;
  /** ISO code, upper-case. */
  currency: string;
}

/** PayPal amounts are decimal strings ("134.60"); cents, exactly. */
export function payPalValueToCents(value: string | undefined): number | null {
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
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
  private created = new Map<
    string,
    { amountCents: number; currency: string; approvedAt: Date; captured: boolean }
  >();

  async createOrderApproval(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    returnUrl: string;
  }): Promise<PayPalApproval> {
    // One PayPal order per attempt, as with the real API.
    const ref = `pp_fake_${input.orderId}_${randomUUID().slice(0, 8)}`;
    // The fake bounces straight to the return leg: approved at once.
    this.created.set(ref, {
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      approvedAt: new Date(),
      captured: false,
    });
    const sep = input.returnUrl.includes("?") ? "&" : "?";
    return { url: `${input.returnUrl}${sep}ppfake=1`, ref };
  }

  async captureOrder(ref: string): Promise<PayPalCapture> {
    // Refs the fake never issued fail, like a bogus capture would. Refs from
    // another process (dev server restart) still capture, at no known amount.
    const known = this.created.get(ref);
    if (known) {
      known.captured = true;
      return { paid: true, amountCents: known.amountCents, currency: known.currency };
    }
    return ref.startsWith("pp_fake_")
      ? { paid: true, amountCents: 0, currency: "" }
      : { paid: false, amountCents: 0, currency: "" };
  }

  async getOrderState(ref: string): Promise<PayPalOrderState | null> {
    const known = this.created.get(ref);
    if (!known) return null;
    return {
      status: known.captured ? "COMPLETED" : "APPROVED",
      approvedAt: known.approvedAt,
      capture: known.captured
        ? { paid: true, amountCents: known.amountCents, currency: known.currency }
        : { paid: false, amountCents: 0, currency: "" },
    };
  }

  /** Test hook: when the guest approved. */
  setApprovedAt(ref: string, at: Date): void {
    const known = this.created.get(ref);
    if (known) known.approvedAt = at;
  }

  /** Test hook: captured at PayPal, as if our own write had then failed. */
  markCapturedAtPayPal(ref: string): void {
    const known = this.created.get(ref);
    if (known) known.captured = true;
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

  async captureOrder(ref: string): Promise<PayPalCapture> {
    const token = await this.accessToken();
    const res = await fetch(`${this.base}/v2/checkout/orders/${encodeURIComponent(ref)}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 422) {
      // ORDER_ALREADY_CAPTURED — a double return leg. Idempotent success.
      const body = await res.text();
      if (body.includes("ORDER_ALREADY_CAPTURED")) return this.fetchOrder(ref);
      log.warn("paypal.capture_422", { ref, body });
      return { paid: false, amountCents: 0, currency: "" };
    }
    if (!res.ok) {
      log.error("paypal.capture_failed", { ref, status: res.status });
      return { paid: false, amountCents: 0, currency: "" };
    }
    return readCapture(await res.json());
  }

  /** The order as PayPal holds it now — used when it was captured before. */
  private async fetchOrder(ref: string): Promise<PayPalCapture> {
    return (
      (await this.getOrderState(ref))?.capture ?? { paid: false, amountCents: 0, currency: "" }
    );
  }

  async getOrderState(ref: string): Promise<PayPalOrderState | null> {
    try {
      const token = await this.accessToken();
      const res = await fetch(`${this.base}/v2/checkout/orders/${encodeURIComponent(ref)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { status?: string; update_time?: string };
      const status = body.status ?? "UNKNOWN";
      return {
        status,
        // PayPal stamps update_time when the payer approves (and again at
        // capture); for an APPROVED order it is the approval.
        approvedAt:
          (status === "APPROVED" || status === "COMPLETED") && body.update_time
            ? new Date(body.update_time)
            : null,
        capture: readCapture(body),
      };
    } catch {
      return null;
    }
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

/** The completed capture of a PayPal order response, if any. */
function readCapture(body: unknown): PayPalCapture {
  const b = body as {
    status?: string;
    purchase_units?: {
      payments?: {
        captures?: { status?: string; amount?: { value?: string; currency_code?: string } }[];
      };
    }[];
  };
  const capture = b.purchase_units?.[0]?.payments?.captures?.find((c) => c.status === "COMPLETED");
  const cents = payPalValueToCents(capture?.amount?.value);
  if (b.status !== "COMPLETED" || !capture || cents === null) {
    return { paid: false, amountCents: 0, currency: "" };
  }
  return {
    paid: true,
    amountCents: cents,
    currency: (capture.amount?.currency_code ?? "").toUpperCase(),
  };
}

/* ------------------------------------------------------------------ */
/* Selector                                                            */
/* ------------------------------------------------------------------ */

let cached: PayPalProvider | null = null;

export function getPayPalProvider(): PayPalProvider {
  if (cached) return cached;
  cached =
    env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && payPalEnvUsableHere(env.PAYPAL_ENV)
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
 *
 * `enabled` is NOT consulted here any more: it is the on/off switch for
 * OFFERING PayPal (`payPalOnFor`), checked where a payment starts. Once a
 * payment exists, capturing or verifying it must use the same account
 * that created it — the saved keys whenever they exist — even if the
 * owner switched PayPal off in between.
 */
export function payPalProviderFor(credentials: {
  clientId: string | null;
  secret: string | null;
  env: "sandbox" | "live";
  enabled: boolean;
}): PayPalProvider {
  if (credentials.clientId && credentials.secret && payPalEnvUsableHere(credentials.env)) {
    return new RealPayPalProvider(credentials.clientId, credentials.secret, credentials.env);
  }
  return getPayPalProvider();
}

/**
 * The owner's master switch (Dashboard → Billing → PayPal "Enable",
 * 2026-09-21): PayPal is offered — and a PayPal payment may START — only
 * when it is ticked AND some account can take the money (saved keys, or
 * the PAYPAL_* env pair). Off hides PayPal on the website and in the app
 * even when prod.env carries keys.
 */
export function payPalOnFor(keys: {
  clientId: string | null;
  secret: string | null;
  enabled: boolean;
}): boolean {
  return keys.enabled && paypalAvailable(Boolean(keys.clientId && keys.secret));
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
