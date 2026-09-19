import { asTenant, asUser } from "./tenant";
import { encryptSecret, decryptSecret, maskSecret } from "./secrets";

/**
 * "Own keys" payout mode for a restaurant (upfront/flat-fee plans): the
 * restaurant charges guests with their OWN Stripe account and keeps 100%.
 * Keys are encrypted at rest; only masked hints are ever shown back. Whether
 * they're actually used at checkout is decided later by the fee mode +
 * `enabled` flag (payment routing).
 */

export interface OwnKeysStatus {
  secretMask: string | null;
  webhookMask: string | null;
  /** Publishable key in the clear — it is a public identifier, not a
   *  secret, and the mobile payment sheet needs it verbatim. */
  publishable: string | null;
  enabled: boolean;
  /** True once a secret key has been stored. */
  hasSecret: boolean;
}

export async function getOwnKeysStatus(userId: string): Promise<OwnKeysStatus> {
  return asUser(userId, async (tx) => {
    const t = await tx.tenant.findFirst({
      select: {
        stripeOwnSecretMask: true,
        stripeOwnWebhookMask: true,
        stripeOwnSecretEnc: true,
        stripeOwnPublishable: true,
        stripeOwnEnabled: true,
      },
    });
    return {
      secretMask: t?.stripeOwnSecretMask ?? null,
      webhookMask: t?.stripeOwnWebhookMask ?? null,
      publishable: t?.stripeOwnPublishable ?? null,
      enabled: t?.stripeOwnEnabled ?? false,
      hasSecret: Boolean(t?.stripeOwnSecretEnc),
    };
  });
}

export interface OwnKeys {
  secret: string | null;
  webhook: string | null;
  enabled: boolean;
}

/** Decrypted keys for server-side charging. Never return to a client. */
export async function getOwnKeys(userId: string): Promise<OwnKeys> {
  return asUser(userId, async (tx) => {
    const t = await tx.tenant.findFirst({
      select: {
        stripeOwnSecretEnc: true,
        stripeOwnWebhookEnc: true,
        stripeOwnEnabled: true,
      },
    });
    return {
      secret: decryptSecret(t?.stripeOwnSecretEnc),
      webhook: decryptSecret(t?.stripeOwnWebhookEnc),
      enabled: t?.stripeOwnEnabled ?? false,
    };
  });
}

/**
 * Save the restaurant's own keys / toggle. Non-empty key fields are
 * encrypted + masked (write-once — blank keeps the current value); `enabled`
 * is always set from the form. Enabling without a secret on file is a no-op
 * guard the caller should surface.
 */
export async function updateOwnKeys(
  userId: string,
  patch: { secret?: string; webhook?: string; publishable?: string; enabled: boolean },
): Promise<void> {
  await asUser(userId, async (tx) => {
    const data: Record<string, string | boolean> = { stripeOwnEnabled: patch.enabled };
    // Public identifier — stored as typed, not encrypted or masked, because
    // the app receives it verbatim. Blank keeps the current value, like the
    // secret fields, so a save that only flips `enabled` is harmless.
    const publishable = patch.publishable?.trim();
    if (publishable) data.stripeOwnPublishable = publishable;
    const secret = patch.secret?.trim();
    if (secret) {
      data.stripeOwnSecretEnc = encryptSecret(secret);
      data.stripeOwnSecretMask = maskSecret(secret);
    }
    const webhook = patch.webhook?.trim();
    if (webhook) {
      data.stripeOwnWebhookEnc = encryptSecret(webhook);
      data.stripeOwnWebhookMask = maskSecret(webhook);
    }
    await tx.tenant.updateMany({ data });
  });
}

/* ------------------------------------------------------------------ */
/* PayPal — same posture: encrypted at rest, masked when shown         */
/* ------------------------------------------------------------------ */

export interface PayPalKeysStatus {
  clientIdMask: string | null;
  secretMask: string | null;
  webhookIdMask: string | null;
  env: "sandbox" | "live";
  enabled: boolean;
  hasCredentials: boolean;
}

export async function getPayPalKeysStatus(userId: string): Promise<PayPalKeysStatus> {
  return asUser(userId, async (tx) => {
    const t = await tx.tenant.findFirst({
      select: {
        paypalClientIdMask: true,
        paypalSecretMask: true,
        paypalWebhookIdMask: true,
        paypalClientIdEnc: true,
        paypalSecretEnc: true,
        paypalEnv: true,
        paypalOwnEnabled: true,
      },
    });
    return {
      clientIdMask: t?.paypalClientIdMask ?? null,
      secretMask: t?.paypalSecretMask ?? null,
      webhookIdMask: t?.paypalWebhookIdMask ?? null,
      env: t?.paypalEnv === "live" ? "live" : "sandbox",
      enabled: t?.paypalOwnEnabled ?? false,
      hasCredentials: Boolean(t?.paypalClientIdEnc && t?.paypalSecretEnc),
    };
  });
}

export interface PayPalKeys {
  clientId: string | null;
  secret: string | null;
  /** Webhook id the restaurant registered /api/paypal/webhook under. */
  webhookId: string | null;
  env: "sandbox" | "live";
  enabled: boolean;
}

/** Decrypted PayPal credentials for server-side charging. Never expose. */
export async function getPayPalKeys(userId: string): Promise<PayPalKeys> {
  return asUser(userId, async (tx) => {
    const t = await tx.tenant.findFirst({
      select: {
        paypalClientIdEnc: true,
        paypalSecretEnc: true,
        paypalWebhookIdEnc: true,
        paypalEnv: true,
        paypalOwnEnabled: true,
      },
    });
    return {
      clientId: decryptSecret(t?.paypalClientIdEnc),
      secret: decryptSecret(t?.paypalSecretEnc),
      webhookId: decryptSecret(t?.paypalWebhookIdEnc),
      env: t?.paypalEnv === "live" ? "live" : "sandbox",
      enabled: t?.paypalOwnEnabled ?? false,
    };
  });
}

/** Save PayPal credentials / toggle. Blank fields keep the stored value. */
export async function updatePayPalKeys(
  userId: string,
  patch: {
    clientId?: string;
    secret?: string;
    webhookId?: string;
    env: "sandbox" | "live";
    enabled: boolean;
  },
): Promise<void> {
  await asUser(userId, async (tx) => {
    const data: Record<string, string | boolean> = {
      paypalOwnEnabled: patch.enabled,
      paypalEnv: patch.env,
    };
    const clientId = patch.clientId?.trim();
    if (clientId) {
      data.paypalClientIdEnc = encryptSecret(clientId);
      data.paypalClientIdMask = maskSecret(clientId);
    }
    const secret = patch.secret?.trim();
    if (secret) {
      data.paypalSecretEnc = encryptSecret(secret);
      data.paypalSecretMask = maskSecret(secret);
    }
    const webhookId = patch.webhookId?.trim();
    if (webhookId) {
      data.paypalWebhookIdEnc = encryptSecret(webhookId);
      data.paypalWebhookIdMask = maskSecret(webhookId);
    }
    await tx.tenant.updateMany({ data });
  });
}

/** Tenant-scoped variant for the guest payment path, which has a tenantId
 *  (from the receipt token) but no signed-in user. */
export async function getPayPalKeysForTenant(tenantId: string): Promise<PayPalKeys> {
  return asTenant(tenantId, async (tx) => {
    const t = await tx.tenant.findFirst({
      select: {
        paypalClientIdEnc: true,
        paypalSecretEnc: true,
        paypalWebhookIdEnc: true,
        paypalEnv: true,
        paypalOwnEnabled: true,
      },
    });
    return {
      clientId: decryptSecret(t?.paypalClientIdEnc),
      secret: decryptSecret(t?.paypalSecretEnc),
      webhookId: decryptSecret(t?.paypalWebhookIdEnc),
      env: t?.paypalEnv === "live" ? "live" : "sandbox",
      enabled: t?.paypalOwnEnabled ?? false,
    };
  });
}
