import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { decryptSecret } from "../src/lib/secrets";
import { checkoutExpiresAtSeconds } from "../src/lib/payment-windows";

/**
 * Which payment methods will guests actually see now that order payments
 * are authorize-only (owner, 2026-10-21)? Stripe Checkout shows only the
 * methods enabled in the Dashboard that ALSO support a manual capture, so
 * the honest answer comes from Stripe itself, for this account:
 *
 *   ./deploy/deploy.sh stripecheck
 *
 * It creates ONE Checkout Session exactly like an order's (1,00 €, manual
 * capture, 30-minute expiry), prints the methods Stripe put on it, then
 * expires it at once. Nothing can be paid on it and nothing is charged.
 * For comparison it also lists every method enabled in the Dashboard.
 *
 * Uses the restaurant's saved keys (Dashboard → Payments), else
 * STRIPE_SECRET_KEY — the same account real orders use.
 */

async function secretKey(): Promise<string> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const slug = process.env.RESTAURANT_SLUG ?? "rangla-punjab";
    const venue = await prisma.venue.findUnique({ where: { slug }, select: { tenantId: true } });
    if (!venue) throw new Error(`no venue with slug "${slug}"`);
    const tenant = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${venue.tenantId}, true)`;
      return tx.tenant.findFirst({ select: { stripeOwnSecretEnc: true } });
    });
    const own = decryptSecret(tenant?.stripeOwnSecretEnc);
    const key = own ?? process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("no Stripe secret key saved (Dashboard → Payments) or in prod.env");
    return key;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const key = await secretKey();
  const stripe = new Stripe(key);
  const mode = key.startsWith("sk_live") || key.startsWith("rk_live") ? "LIVE" : "TEST";
  console.log(`Stripe account mode: ${mode}`);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: 100,
          product_data: { name: "Capture check — not payable" },
        },
      },
    ],
    payment_intent_data: { capture_method: "manual" },
    expires_at: checkoutExpiresAtSeconds(),
    success_url: "https://example.invalid/ok",
    cancel_url: "https://example.invalid/cancel",
  });
  console.log("\nMethods guests will see on an order's card page (manual capture):");
  for (const m of session.payment_method_types) console.log(`  ✓ ${m}`);
  console.log(
    `  capture_method: manual · expires_at: ${new Date(session.expires_at * 1000).toISOString()}`,
  );
  await stripe.checkout.sessions.expire(session.id);
  console.log(`  (check session ${session.id} expired again — nothing payable)`);

  try {
    const configs = await stripe.paymentMethodConfigurations.list({ limit: 10 });
    const def = configs.data.find((c) => c.is_default) ?? configs.data[0];
    if (def) {
      const enabled = Object.entries(def as unknown as Record<string, unknown>)
        .filter(([, v]) => {
          const pref = (v as { display_preference?: { value?: string } } | null)
            ?.display_preference;
          return pref?.value === "on";
        })
        .map(([k]) => k);
      const hidden = enabled.filter((m) => !session.payment_method_types.includes(m));
      console.log(`\nEnabled in the Stripe Dashboard: ${enabled.join(", ") || "(none listed)"}`);
      console.log(
        hidden.length
          ? `NOT offered for orders any more (no manual capture): ${hidden.join(", ")}`
          : "Every enabled method stays available.",
      );
    }
  } catch {
    console.log(
      "\n(Dashboard method list not readable with this key — the list above is authoritative.)",
    );
  }
}

if (process.argv[1]?.endsWith("stripe-capture-check.ts")) {
  main().catch((err) => {
    console.error(`✗ stripecheck: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
