import { cache } from "react";
import { prisma } from "./db";
import { encryptSecret, decryptSecret, maskSecret } from "./secrets";

/**
 * P2-1 — operator (deploy-level) settings.
 *
 * One deploy serves one operator, so these knobs live in a single-row
 * `operator_settings` table (not tenant-scoped). The row is pinned to a
 * fixed id and seeded by the migration; the reader below still falls back
 * to the same defaults if the row is somehow absent, so callers never have
 * to handle a null.
 */

export type FeeMode = "upfront" | "percentage";

export type EmailTransport = "mailhog" | "resend" | "console";

export const EMAIL_TRANSPORTS: readonly EmailTransport[] = ["mailhog", "resend", "console"];

/** Narrow an arbitrary DB string to a valid transport, or null. */
export function asEmailTransport(v: string | null | undefined): EmailTransport | null {
  return v && (EMAIL_TRANSPORTS as readonly string[]).includes(v) ? (v as EmailTransport) : null;
}

/** Selectable app themes. "default" = the built-in Resto look; each
 *  other id maps to a `:root[data-theme="<id>"]` block in globals.css. */
export interface AppTheme {
  id: string;
  label: string;
  tagline: string;
}
export const APP_THEMES: readonly AppTheme[] = [
  {
    id: "default",
    label: "Resto",
    tagline: "Espresso, cream & burnt-orange — the default look.",
  },
  { id: "reztro", label: "Reztro", tagline: "Clean light dashboard with a fresh-green accent." },
];
export function asAppTheme(v: string | null | undefined): string {
  return v && APP_THEMES.some((t) => t.id === v) ? v : "default";
}

export interface OperatorSettings {
  feeMode: FeeMode;
  /** Basis points (100 = 1%) applied in `percentage` mode. */
  feeBp: number;
  /** Orders at or below this total pay no operator fee. */
  feeMinCents: number;
  /** Kill switch: when false, public order + pay routes are paused. */
  siteActive: boolean;
  /** Runtime override for the email transport; null ⇒ use env.EMAIL_TRANSPORT. */
  emailTransport: EmailTransport | null;
  /** Runtime override for the From address; null ⇒ use env.EMAIL_FROM. */
  emailFrom: string | null;
  /** Active app theme id; drives data-theme on <html>. "default" = built-in. */
  appTheme: string;
  /** Masked hints for the platform Stripe keys (safe to display); null when
   *  unset (env value is used instead). Never the real secret. */
  stripeSecretMask: string | null;
  stripeWebhookMask: string | null;
  stripeConnectWebhookMask: string | null;
}

export const DEFAULT_OPERATOR_SETTINGS: OperatorSettings = {
  // Single-restaurant build: the restaurant charges on its OWN Stripe /
  // PayPal account and keeps 100%. "upfront" is what switches Dashboard →
  // Payments to the own-keys form and routes checkout through those keys;
  // "percentage" (the old SaaS default) would demand a Stripe Connect
  // onboarding nobody in this deployment can complete.
  feeMode: "upfront",
  feeBp: 500,
  feeMinCents: 2000,
  siteActive: true,
  emailTransport: null,
  emailFrom: null,
  appTheme: "default",
  stripeSecretMask: null,
  stripeWebhookMask: null,
  stripeConnectWebhookMask: null,
};

const SINGLETON_ID = "singleton";

/**
 * P2-2 — the operator fee for one order, from settings. Pure and
 * synchronous so it is trivially unit-testable:
 *   · `upfront`            ⇒ 0 (operator bills a lump sum out of band)
 *   · total ≤ feeMinCents  ⇒ 0 (small orders are free)
 *   · otherwise            ⇒ feeBp basis points of the total
 */
export function computePlatformFeeCents(amountCents: number, settings: OperatorSettings): number {
  // Rangla Punjab is a single-restaurant white-label: the restaurant runs
  // its OWN payment gateways and keeps 100% of every order. No commission,
  // no subscription — structurally, not by configuration. The settings
  // parameters survive only for API compatibility.
  void amountCents;
  void settings;
  return 0;
}

/**
 * Read the operator settings for this request. Wrapped in React `cache`
 * so every consumer in a request shares one DB hit. Falls back to
 * {@link DEFAULT_OPERATOR_SETTINGS} if the row is missing.
 */
export const getOperatorSettings = cache(async (): Promise<OperatorSettings> => {
  const row = await prisma.operatorSettings.findUnique({
    where: { id: SINGLETON_ID },
    select: {
      feeMode: true,
      feeBp: true,
      feeMinCents: true,
      siteActive: true,
      emailTransport: true,
      emailFrom: true,
      appTheme: true,
      stripeSecretMask: true,
      stripeWebhookMask: true,
      stripeConnectWebhookMask: true,
    },
  });
  if (!row) return DEFAULT_OPERATOR_SETTINGS;
  return {
    // Pinned, not read: a row saved by an older build may still say
    // "percentage", and /admin/settings has pinned this to "upfront" since
    // the single-restaurant cut. Honouring a stale value would hide the
    // own-keys form and send guests into a Connect flow that cannot work.
    feeMode: "upfront",
    feeBp: row.feeBp,
    feeMinCents: row.feeMinCents,
    siteActive: row.siteActive,
    emailTransport: asEmailTransport(row.emailTransport),
    emailFrom: row.emailFrom?.trim() || null,
    appTheme: asAppTheme(row.appTheme),
    stripeSecretMask: row.stripeSecretMask,
    stripeWebhookMask: row.stripeWebhookMask,
    stripeConnectWebhookMask: row.stripeConnectWebhookMask,
  };
});

/** Persist a partial update to the operator settings (Operator Console). */
export async function updateOperatorSettings(
  patch: Partial<OperatorSettings>,
): Promise<OperatorSettings> {
  const row = await prisma.operatorSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...patch },
    update: patch,
    select: {
      feeMode: true,
      feeBp: true,
      feeMinCents: true,
      siteActive: true,
      emailTransport: true,
      emailFrom: true,
      appTheme: true,
      stripeSecretMask: true,
      stripeWebhookMask: true,
      stripeConnectWebhookMask: true,
    },
  });
  return {
    feeMode: row.feeMode,
    feeBp: row.feeBp,
    feeMinCents: row.feeMinCents,
    siteActive: row.siteActive,
    emailTransport: asEmailTransport(row.emailTransport),
    emailFrom: row.emailFrom?.trim() || null,
    appTheme: asAppTheme(row.appTheme),
    stripeSecretMask: row.stripeSecretMask,
    stripeWebhookMask: row.stripeWebhookMask,
    stripeConnectWebhookMask: row.stripeConnectWebhookMask,
  };
}

export interface PlatformStripeKeys {
  secret: string | null;
  webhook: string | null;
  connectWebhook: string | null;
}

/**
 * Decrypted platform Stripe keys for server-side use (getStripeProvider).
 * NEVER return these to a client component — pages read the masked hints from
 * getOperatorSettings instead. A missing/undecryptable value is null so the
 * caller falls back to the env var.
 */
export async function getPlatformStripeKeys(): Promise<PlatformStripeKeys> {
  const row = await prisma.operatorSettings.findUnique({
    where: { id: SINGLETON_ID },
    select: { stripeSecretEnc: true, stripeWebhookEnc: true, stripeConnectWebhookEnc: true },
  });
  return {
    secret: decryptSecret(row?.stripeSecretEnc),
    webhook: decryptSecret(row?.stripeWebhookEnc),
    connectWebhook: decryptSecret(row?.stripeConnectWebhookEnc),
  };
}

/**
 * Store one or more platform Stripe keys (Operator Console). Each provided,
 * non-empty value is encrypted at rest and a masked hint saved alongside; an
 * empty/undefined field leaves the existing value untouched (write-once UX).
 */
export async function updatePlatformStripeKeys(patch: {
  secret?: string;
  webhook?: string;
  connectWebhook?: string;
}): Promise<void> {
  const data: Record<string, string> = {};
  const set = (val: string | undefined, encCol: string, maskCol: string): void => {
    const v = val?.trim();
    if (!v) return;
    data[encCol] = encryptSecret(v);
    data[maskCol] = maskSecret(v);
  };
  set(patch.secret, "stripeSecretEnc", "stripeSecretMask");
  set(patch.webhook, "stripeWebhookEnc", "stripeWebhookMask");
  set(patch.connectWebhook, "stripeConnectWebhookEnc", "stripeConnectWebhookMask");
  if (Object.keys(data).length === 0) return;
  await prisma.operatorSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
}
