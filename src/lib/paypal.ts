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
    orderId: string;
    amountCents: number;
    currency: string;
    label: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<PayPalApproval>;
  /** Capture an approved order. Idempotent: already-captured counts as paid. */
  captureOrder(ref: string): Promise<{ paid: boolean }>;
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
