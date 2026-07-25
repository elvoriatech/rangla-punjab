import { createHash } from "node:crypto";
import { env } from "../env";
import { getPlatformStripeKeys } from "../operator-settings";
import { FakeStripeProvider } from "./fake-provider";
import type { StripeProvider } from "./provider";

export type { StripeProvider, StripeEvent } from "./provider";
export { FakeStripeProvider } from "./fake-provider";

/**
 * Provider selector. Keys come from the operator's DB settings (managed in
 * /admin, changeable without a redeploy) and fall back to env when unset.
 * Real Stripe only when *both* the secret + webhook resolve — a
 * half-configured deployment is worse than an obvious fake.
 *
 * Cached on `globalThis` keyed by a fingerprint of the resolved keys, so the
 * real SDK's keepalive pool is reused across HMR reloads AND a key change in
 * the DB rebuilds the provider on the next call.
 */
const globalForStripe = globalThis as unknown as {
  stripeProvider?: StripeProvider;
  stripeFingerprint?: string;
};

interface ResolvedKeys {
  secret: string | null;
  webhook: string | null;
  connectWebhook: string | null;
}

async function resolveKeys(): Promise<ResolvedKeys> {
  // DB (operator-managed) wins; env is the fallback default.
  const db = await getPlatformStripeKeys().catch(
    () => ({ secret: null, webhook: null, connectWebhook: null }) as ResolvedKeys,
  );
  return {
    secret: db.secret ?? env.STRIPE_SECRET_KEY ?? null,
    webhook: db.webhook ?? env.STRIPE_WEBHOOK_SECRET ?? null,
    connectWebhook: db.connectWebhook ?? env.STRIPE_CONNECT_WEBHOOK_SECRET ?? null,
  };
}

function fingerprint(k: ResolvedKeys): string {
  return createHash("sha256")
    .update(`${k.secret ?? ""}|${k.webhook ?? ""}|${k.connectWebhook ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

async function build(k: ResolvedKeys): Promise<StripeProvider> {
  if (k.secret && k.webhook) {
    // Dynamic import so the `stripe` SDK doesn't reach every code path.
    const { RealStripeProvider } = await import("./real-provider");
    return new RealStripeProvider(k.secret, k.webhook, k.connectWebhook ?? undefined);
  }
  return new FakeStripeProvider(k.webhook ?? "test-webhook-secret");
}

export async function getStripeProvider(): Promise<StripeProvider> {
  const keys = await resolveKeys();
  const fp = fingerprint(keys);
  if (globalForStripe.stripeProvider && globalForStripe.stripeFingerprint === fp) {
    return globalForStripe.stripeProvider;
  }
  const provider = await build(keys);
  globalForStripe.stripeProvider = provider;
  globalForStripe.stripeFingerprint = fp;
  return provider;
}

/** Explicit selector for tests that want to know which provider was picked. */
export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

/**
 * A provider built from a SPECIFIC secret key — used for a restaurant's own
 * keys (direct charge, no Connect). A real `sk_…` key gets the real SDK
 * bound to that account; anything else falls back to the fake provider (the
 * shared instance when the platform itself is fake, so the local pay flow
 * settles) so demo/testing never charges a real card. NOT cached — own-key
 * callers are the payment path, not the hot public path.
 */
export async function stripeProviderForKey(
  secret: string,
  webhook?: string | null,
): Promise<StripeProvider> {
  if (secret.startsWith("sk_")) {
    const { RealStripeProvider } = await import("./real-provider");
    return new RealStripeProvider(secret, webhook ?? "", webhook ?? undefined);
  }
  const shared = await getStripeProvider();
  return shared.mode === "fake" ? shared : new FakeStripeProvider(webhook ?? "test-webhook-secret");
}
