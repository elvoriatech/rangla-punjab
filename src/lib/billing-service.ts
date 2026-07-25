import { prisma } from "./db";
import { asTenant, asUser } from "./tenant";
import { PLANS, type PlanCode } from "./plans";
import { getStripeProvider } from "./stripe";

/**
 * Billing service. Callers (routes + server actions) hand it a userId
 * and a plan choice; we resolve the tenant via `asUser`, ensure a
 * Stripe customer exists (creating one on first checkout), and hand
 * back a URL for the browser to redirect to.
 *
 * Price IDs live in env vars named by `PLANS[code].stripePriceIdEnv`;
 * when the env is unset (dev + CI ride on the fake provider), we fall
 * back to a stable `price_test_<code>` sentinel so the fake sees a
 * plausible id.
 */

export type CheckoutResult =
  { ok: true; url: string } | { ok: false; error: "no_tenant" | "unknown_plan" };

export type PortalResult = { ok: true; url: string } | { ok: false; error: "no_customer" };

export async function createCheckout(
  userId: string,
  planCode: PlanCode,
  urls: { successUrl: string; cancelUrl: string },
): Promise<CheckoutResult> {
  const plan = PLANS[planCode];
  if (!plan) return { ok: false, error: "unknown_plan" };
  const priceId = process.env[plan.stripePriceIdEnv] ?? `price_test_${planCode}`;

  const provider = await getStripeProvider();

  const tenant = await asUser(userId, async (tx) => {
    return tx.tenant.findFirstOrThrow({
      select: {
        id: true,
        subscription: { select: { id: true, stripeCustomerId: true } },
      },
    });
  });

  // Look up the user's email once — we need it to name the Stripe
  // customer. `users` isn't RLS-scoped so a direct `prisma` read is fine.
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });

  let customerId = tenant.subscription?.stripeCustomerId ?? null;
  if (!customerId) {
    const created = await provider.createCustomer({
      email: user.email,
      tenantId: tenant.id,
    });
    customerId = created.id;
    // Persist the customer so the next checkout / portal call reuses it.
    // Sub row may not exist yet; upsert-shape via find-then-create/update
    // (same rationale as P1-19c: partial unique blocks Prisma's upsert).
    await asTenant(tenant.id, async (tx) => {
      const existing = await tx.subscription.findFirst({
        where: { tenantId: tenant.id, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        await tx.subscription.update({
          where: { id: existing.id },
          data: { stripeCustomerId: customerId },
        });
      } else {
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            stripeCustomerId: customerId,
            planCode: planCode,
            status: "incomplete",
          },
        });
      }
    });
  }

  // No Stripe-side trial: the 30-day in-app trial (no card) already
  // happened before the owner reaches checkout, so the card is charged
  // immediately when they pick a plan.
  const session = await provider.createCheckoutSession({
    customerId,
    priceId,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    tenantId: tenant.id,
    planCode,
  });
  return { ok: true, url: session.url };
}

export async function createBillingPortal(
  userId: string,
  returnUrl: string,
): Promise<PortalResult> {
  const provider = await getStripeProvider();
  const customerId = await asUser(userId, async (tx) => {
    const sub = await tx.subscription.findFirst({
      where: { deletedAt: null },
      select: { stripeCustomerId: true },
    });
    return sub?.stripeCustomerId ?? null;
  });
  if (!customerId) return { ok: false, error: "no_customer" };
  const session = await provider.createBillingPortalSession({ customerId, returnUrl });
  return { ok: true, url: session.url };
}
