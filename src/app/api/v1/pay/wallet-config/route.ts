import { NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { env } from "@/lib/env";
import { getOperatorSettings } from "@/lib/operator-settings";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { decryptSecret } from "@/lib/secrets";
import { getStripeProvider } from "@/lib/stripe";
import { resolvePublishableKey } from "@/lib/stripe/publishable-key";
import { asTenant } from "@/lib/tenant";

/**
 * GET /api/v1/pay/wallet-config
 *
 * "May this browser show an Apple Pay / Google Pay button, and with which
 * Stripe account?" — the one thing the guest cart drawer cannot work out
 * on its own (P7-13).
 *
 * Stripe's `PaymentRequestButtonElement` has to exist BEFORE there is an
 * order to pay for: it needs a publishable key to construct the payment
 * request and ask the browser `canMakePayment()`. The public menu page is
 * static and edge-cached, so the key cannot ride down with the HTML —
 * the drawer asks for it here, once, when the guest opens the sheet.
 *
 * A publishable key is a public identifier, not a secret (it is in every
 * Stripe checkout's page source). What matters is that it PAIRS with the
 * account that will issue the PaymentIntent, which is why this reuses the
 * same resolver `/api/orders/[id]/pay/intent` does — a mismatched pair
 * makes Stripe reject the confirmation with a baffling client error.
 *
 * `publishableKey: null` is the normal, safe answer: no Stripe keys, a
 * fake provider (dev, CI, an unconfigured deployment), or a percentage
 * fee model the intent endpoint refuses anyway. The drawer then renders
 * no wallet button at all — exactly as if this endpoint did not exist.
 */
export async function GET(): Promise<NextResponse> {
  const off = {
    ok: true as const,
    publishableKey: null,
    applePay: false,
    /** Merchant country for the payment request. DE — the billing model
     *  is "Stripe Billing + Stripe Tax, DE as merchant of record"
     *  (CLAUDE.md decisions log), and the app passes the same code. */
    country: "DE",
  };

  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (!context || context.mode !== "public") return withCors(NextResponse.json(off));

  // Same gate as the intent endpoint: a Connect destination charge needs
  // the connected account's own publishable key, which this contract has
  // no room for, so those deployments get no wallet button.
  const settings = await getOperatorSettings();
  if (settings.feeMode !== "upfront") return withCors(NextResponse.json(off));

  const tenant = await asTenant(context.tenantId, (tx) =>
    tx.tenant.findFirstOrThrow({
      select: {
        stripeOwnEnabled: true,
        stripeOwnSecretEnc: true,
        stripeOwnPublishable: true,
      },
    }),
  );

  // Own keys pasted in Dashboard → Payments win; otherwise the
  // deployment's shared Stripe keys ARE the restaurant's account. Either
  // way a wallet button only makes sense against a REAL account: the fake
  // provider has no PaymentIntent for Stripe.js to confirm.
  const ownSecret = tenant.stripeOwnEnabled ? decryptSecret(tenant.stripeOwnSecretEnc) : null;
  const real = ownSecret
    ? ownSecret.startsWith("sk_")
    : (await getStripeProvider()).mode === "real";
  const publishableKey = real ? resolvePublishableKey(tenant) : null;

  return withCors(
    NextResponse.json({
      ...off,
      publishableKey,
      // ⛔ Human-gated: Apple Pay on the web needs the merchant domain
      // verified with Apple. Google Pay rides on the same element with no
      // extra setup, so the button can still appear on Chrome/Android
      // while this stays off.
      applePay: publishableKey !== null && env.APPLE_PAY_WEB_ENABLED === "true",
    }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
