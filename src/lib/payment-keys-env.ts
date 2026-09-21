import { env } from "./env";
import { prisma } from "./db";
import { asTenant } from "./tenant";

/**
 * Single-restaurant deploy: `prod.env` is the one place this client is
 * configured (docs/RESTO-ARCHITECTURE.md). When it carries a provider's
 * keys, those are the ONLY keys for that provider — keys saved in the
 * database (Dashboard → Billing, Admin → Settings) are removed at boot and
 * the forms that would save new ones are hidden.
 *
 * Payment-time precedence is untouched (saved keys would still win); with
 * nothing saved, every path falls back to prod.env. A provider whose keys
 * are NOT in prod.env keeps its saved keys, so this can never leave a
 * working payment method without credentials.
 */

/** prod.env holds Stripe keys (secret + webhook — what the provider needs). */
export function stripeKeysInEnv(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

/** prod.env holds PayPal REST credentials. */
export function payPalKeysInEnv(): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

export async function clearSavedPaymentKeys(
  opts: { tenantId?: string } = {},
): Promise<{ stripe: boolean; paypal: boolean }> {
  const stripe = stripeKeysInEnv();
  const paypal = payPalKeysInEnv();
  if (!stripe && !paypal) return { stripe, paypal };

  const tenantId = opts.tenantId ?? (await restaurantTenantId());
  if (tenantId) {
    await asTenant(tenantId, (tx) =>
      tx.tenant.updateMany({
        data: {
          ...(stripe && {
            stripeOwnSecretEnc: null,
            stripeOwnSecretMask: null,
            stripeOwnWebhookEnc: null,
            stripeOwnWebhookMask: null,
            stripeOwnPublishable: null,
            stripeOwnEnabled: false,
          }),
          ...(paypal && {
            paypalClientIdEnc: null,
            paypalClientIdMask: null,
            paypalSecretEnc: null,
            paypalSecretMask: null,
            paypalWebhookIdEnc: null,
            paypalWebhookIdMask: null,
            paypalOwnEnabled: false,
          }),
        },
      }),
    );
  }
  if (stripe) {
    // Admin → Settings platform keys: the other DB layer that outranks env.
    await prisma.operatorSettings.updateMany({
      data: {
        stripeSecretEnc: null,
        stripeSecretMask: null,
        stripeWebhookEnc: null,
        stripeWebhookMask: null,
        stripeConnectWebhookEnc: null,
        stripeConnectWebhookMask: null,
      },
    });
  }
  return { stripe, paypal };
}

/** The one restaurant: `RESTAURANT_SLUG`'s venue, else the oldest venue
 *  (same rule as `getRestaurantSlug`). */
async function restaurantTenantId(): Promise<string | null> {
  const slug = process.env.RESTAURANT_SLUG?.trim();
  const venue = await prisma.venue.findFirst({
    where: slug ? { slug, deletedAt: null } : { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { tenantId: true },
  });
  return venue?.tenantId ?? null;
}
