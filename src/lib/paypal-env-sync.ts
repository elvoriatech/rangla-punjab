import { env } from "./env";
import { prisma } from "./db";
import { asTenant } from "./tenant";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";

/**
 * Single-restaurant deploy: `prod.env` is the one place this client is
 * configured (docs/RESTO-ARCHITECTURE.md), so at boot its PAYPAL_* keys
 * replace whatever PayPal keys are saved in the database — including
 * sandbox keys left over from testing. Dashboard → Billing then shows, and
 * payments use, exactly what prod.env holds.
 *
 * Payment-time precedence is untouched (saved keys win); this just makes
 * the saved keys equal prod.env. Without PAYPAL_CLIENT_ID + SECRET it does
 * nothing, so dev/CI and a deploy that manages PayPal from the dashboard
 * only are unaffected. A restart with identical keys writes nothing.
 */
export async function syncPayPalKeysFromEnv(
  opts: { tenantId?: string } = {},
): Promise<{ updated: boolean }> {
  const clientId = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  const webhookId = env.PAYPAL_WEBHOOK_ID ?? null;
  if (!clientId || !secret) return { updated: false };

  const tenantId = opts.tenantId ?? (await restaurantTenantId());
  if (!tenantId) return { updated: false };

  const updated = await asTenant(tenantId, async (tx) => {
    const t = await tx.tenant.findFirst({
      select: {
        paypalClientIdEnc: true,
        paypalSecretEnc: true,
        paypalWebhookIdEnc: true,
        paypalEnv: true,
        paypalOwnEnabled: true,
      },
    });
    if (!t) return false;
    const inSync =
      decryptSecret(t.paypalClientIdEnc) === clientId &&
      decryptSecret(t.paypalSecretEnc) === secret &&
      decryptSecret(t.paypalWebhookIdEnc) === webhookId &&
      t.paypalEnv === env.PAYPAL_ENV &&
      t.paypalOwnEnabled;
    if (inSync) return false;

    await tx.tenant.updateMany({
      data: {
        paypalClientIdEnc: encryptSecret(clientId),
        paypalClientIdMask: maskSecret(clientId),
        paypalSecretEnc: encryptSecret(secret),
        paypalSecretMask: maskSecret(secret),
        paypalWebhookIdEnc: webhookId ? encryptSecret(webhookId) : null,
        paypalWebhookIdMask: webhookId ? maskSecret(webhookId) : null,
        paypalEnv: env.PAYPAL_ENV,
        paypalOwnEnabled: true,
      },
    });
    return true;
  });
  return { updated };
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
