import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      PAYPAL_CLIENT_ID: "LIVE-client-id-123456",
      PAYPAL_CLIENT_SECRET: "LIVE-secret-abcdef",
      PAYPAL_WEBHOOK_ID: "LIVE-WH-1",
      PAYPAL_ENV: "live",
    },
  };
});

const { prisma } = await import("./db");
const { signupUser } = await import("./auth-service");
const { asTenant } = await import("./tenant");
const { encryptSecret } = await import("./secrets");
const { getPayPalKeysForTenant } = await import("./tenant-payment-keys");
const { syncPayPalKeysFromEnv } = await import("./paypal-env-sync");

describe("syncPayPalKeysFromEnv (prod.env → saved PayPal keys)", () => {
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

  async function tenantWithSandboxKeys(): Promise<string> {
    const s = await signupUser({
      email: `ppsync-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "PP Sync",
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
        },
      }),
    );
    return s.tenantId;
  }

  it("replaces saved sandbox keys with prod.env's live keys; a second boot is a no-op", async () => {
    const tenantId = await tenantWithSandboxKeys();

    expect(await syncPayPalKeysFromEnv({ tenantId })).toEqual({ updated: true });
    expect(await getPayPalKeysForTenant(tenantId)).toEqual({
      clientId: "LIVE-client-id-123456",
      secret: "LIVE-secret-abcdef",
      webhookId: "LIVE-WH-1",
      env: "live",
      enabled: true,
    });

    expect(await syncPayPalKeysFromEnv({ tenantId })).toEqual({ updated: false });
  });
});
