import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const envKeys = vi.hoisted(() => ({
  PAYPAL_CLIENT_ID: "LIVE-client-id" as string | undefined,
  PAYPAL_CLIENT_SECRET: "LIVE-secret" as string | undefined,
  STRIPE_SECRET_KEY: undefined as string | undefined,
  STRIPE_WEBHOOK_SECRET: undefined as string | undefined,
}));

vi.mock("./env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, key) =>
        key in envKeys ? envKeys[key as keyof typeof envKeys] : Reflect.get(target, key),
    }),
  };
});

const { prisma } = await import("./db");
const { signupUser } = await import("./auth-service");
const { asTenant } = await import("./tenant");
const { encryptSecret } = await import("./secrets");
const { getPayPalKeysForTenant } = await import("./tenant-payment-keys");
const { clearSavedPaymentKeys } = await import("./payment-keys-env");

describe("clearSavedPaymentKeys (prod.env keys are the only keys)", () => {
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of tenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    tenantIds.length = 0;
  });

  async function tenantWithSavedKeys(): Promise<string> {
    const s = await signupUser({
      email: `pkenv-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "PK Env",
    });
    if (!s.ok) throw new Error("signup failed");
    userIds.push(s.userId);
    tenantIds.push(s.tenantId);
    await asTenant(s.tenantId, (tx) =>
      tx.tenant.updateMany({
        data: {
          paypalClientIdEnc: encryptSecret("sandbox-id"),
          paypalSecretEnc: encryptSecret("sandbox-secret"),
          paypalWebhookIdEnc: encryptSecret("SANDBOX-WH"),
          paypalEnv: "sandbox",
          paypalOwnEnabled: true,
          stripeOwnSecretEnc: encryptSecret("sk_test_saved"),
          stripeOwnWebhookEnc: encryptSecret("whsec_saved"),
          stripeOwnEnabled: true,
        },
      }),
    );
    return s.tenantId;
  }

  it("removes saved PayPal keys + webhook when prod.env has PayPal, and keeps Stripe's when prod.env has none", async () => {
    const tenantId = await tenantWithSavedKeys();

    expect(await clearSavedPaymentKeys({ tenantId })).toEqual({ stripe: false, paypal: true });

    const paypal = await getPayPalKeysForTenant(tenantId);
    expect(paypal).toMatchObject({ clientId: null, secret: null, webhookId: null, enabled: false });
    // No Stripe keys in prod.env ⇒ the saved ones are the only working
    // credentials, so they must survive.
    const t = await asTenant(tenantId, (tx) =>
      tx.tenant.findFirstOrThrow({ select: { stripeOwnSecretEnc: true, stripeOwnEnabled: true } }),
    );
    expect(t.stripeOwnSecretEnc).not.toBeNull();
    expect(t.stripeOwnEnabled).toBe(true);
  });
});
