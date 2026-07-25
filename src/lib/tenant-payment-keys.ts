import { asUser } from "./tenant";
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
        stripeOwnEnabled: true,
      },
    });
    return {
      secretMask: t?.stripeOwnSecretMask ?? null,
      webhookMask: t?.stripeOwnWebhookMask ?? null,
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
  patch: { secret?: string; webhook?: string; enabled: boolean },
): Promise<void> {
  await asUser(userId, async (tx) => {
    const data: Record<string, string | boolean> = { stripeOwnEnabled: patch.enabled };
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
