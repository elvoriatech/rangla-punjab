import { sanitizeAppReturnUrl } from "./app-return";
import {
  CUSTOMER_PASSWORD_MIN_LENGTH,
  CUSTOMER_PASSWORD_PROVIDER,
  revokeCustomerTokensIn,
} from "./customer-auth";
import { createLogger } from "./logger";
import { uiLocale } from "./locales";
import { hashPassword } from "./password";
import { siteUrl } from "./site-url";
import { asTenant } from "./tenant";
import { hashToken, issueToken } from "./tokens";

/**
 * "I forgot my password" for GUEST accounts (P7-15).
 *
 * The owner flow in `verification-service.ts` is the model — random
 * 32-byte token, stored hashed, single-use, TTL-bounded — with three
 * differences that come from who the guest is:
 *
 *   1. Everything is tenant-scoped and runs under RLS (`asTenant`), so a
 *      token minted for one venue's customer is invisible to another.
 *   2. Only `provider === "password"` customers can reset. A Google guest
 *      has no password to set; telling them so would also say "this
 *      address has an account here", so they get the same silence.
 *   3. Consuming a token revokes every live `customer_tokens` row of that
 *      customer, in the same transaction as the new hash.
 *
 * The request half NEVER reports whether it found anything: the route
 * answers `200 {ok:true}` either way, and this function returning without
 * sending is the only trace of an unknown address. The email itself is
 * venue-branded and speaks the guest's language, because it lands in the
 * inbox of someone who knows the restaurant, not the platform.
 */

const log = createLogger();

/** 60 minutes — long enough to find the mail on another device, short
 *  enough that a forwarded inbox stops being a standing key. */
export const CUSTOMER_RESET_TTL_SECONDS = 60 * 60;

export interface CustomerResetRequestOptions {
  /** Language of the email; falls back to the venue's own. */
  locale?: string | null;
  /** The app's deep link, when the request came from the phone. Rides the
   *  reset link as `?app=` so the web page can hand the browser back. */
  appReturnUrl?: string | null;
}

export type CustomerResetResult =
  { ok: true; customerId: string } | { ok: false; error: "invalid_or_expired" | "weak_password" };

/**
 * Mint a reset token for the password account on `email` and mail the
 * link. Silent (and side-effect-free) when there is no such account, when
 * it was deleted, or when it signs in with Google — the caller answers
 * 200 regardless.
 */
export async function requestCustomerPasswordReset(
  tenantId: string,
  emailRaw: string,
  opts: CustomerResetRequestOptions = {},
): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return;

  const prepared = await asTenant(tenantId, async (tx) => {
    const customer = await tx.customer.findUnique({
      where: {
        tenantId_provider_providerSub: {
          tenantId,
          provider: CUSTOMER_PASSWORD_PROVIDER,
          providerSub: email,
        },
      },
      select: { id: true, email: true, passwordHash: true, deletedAt: true },
    });
    // No account, a deleted one, or an OAuth one with no password to set:
    // all three end here, identically.
    if (!customer || customer.deletedAt || !customer.passwordHash) return null;

    const token = issueToken();
    await tx.customerPasswordResetToken.create({
      data: {
        tenantId,
        customerId: customer.id,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + CUSTOMER_RESET_TTL_SECONDS * 1000),
      },
    });

    const venue = await tx.venue.findFirst({
      where: { deletedAt: null },
      select: { name: true, branding: true, defaultLocale: true },
    });

    return {
      customerId: customer.id,
      email: customer.email,
      plaintext: token.plaintext,
      venue,
    };
  });
  if (!prepared) return;

  const locale = uiLocale(opts.locale ?? prepared.venue?.defaultLocale ?? null);
  const app = sanitizeAppReturnUrl(opts.appReturnUrl);
  const url = new URL(`${siteUrl()}/account/reset/${prepared.plaintext}`);
  url.searchParams.set("locale", locale);
  if (app) url.searchParams.set("app", app);

  // Fire-and-forget: a mail outage must not turn into a 500 that tells the
  // caller this address exists.
  try {
    const { sendEmail } = await import("./email");
    const { ResetPasswordEmail, guestResetSubject } = await import("@/emails/reset-password-email");
    const { venueBrand } = await import("@/emails/layout");
    const { guestResetCopy } = await import("./i18n/emails");
    const venueName = prepared.venue?.name ?? "";
    await sendEmail({
      to: prepared.email,
      subject: guestResetSubject(locale, venueName),
      react: ResetPasswordEmail({
        resetUrl: url.toString(),
        locale,
        copy: guestResetCopy(locale),
        brand: prepared.venue
          ? venueBrand({ name: venueName, ...brandingOf(prepared.venue.branding) })
          : undefined,
      }),
    });
    log.info("customer_reset.emailed", { tenantId, customerId: prepared.customerId });
  } catch {
    log.warn("customer_reset.email_failed", { tenantId, customerId: prepared.customerId });
  }
}

/**
 * Spend a token: set the new Argon2id hash, mark the token used, and sign
 * the customer out everywhere. All three happen in one transaction — see
 * `revokeCustomerTokensIn`.
 */
export async function consumeCustomerPasswordReset(
  tenantId: string,
  plaintext: string,
  newPassword: string,
): Promise<CustomerResetResult> {
  if (newPassword.length < CUSTOMER_PASSWORD_MIN_LENGTH) {
    return { ok: false, error: "weak_password" };
  }
  // Hashed BEFORE the transaction opens: argon2 costs ~40 ms and there is
  // no reason to hold a pooled connection (and an RLS transaction) for it.
  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashToken(plaintext);

  return asTenant(tenantId, async (tx) => {
    const now = new Date();
    const token = await tx.customerPasswordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      select: { id: true, customerId: true },
    });
    if (!token) return { ok: false as const, error: "invalid_or_expired" as const };

    // The account may have been deleted, or converted, since the mail went
    // out — an expired-looking answer is the right one either way.
    const customer = await tx.customer.findFirst({
      where: {
        id: token.customerId,
        deletedAt: null,
        provider: CUSTOMER_PASSWORD_PROVIDER,
      },
      select: { id: true },
    });
    if (!customer) return { ok: false as const, error: "invalid_or_expired" as const };

    await tx.customerPasswordResetToken.update({
      where: { id: token.id },
      data: { usedAt: now },
    });
    await tx.customer.update({
      where: { id: customer.id },
      data: { passwordHash },
    });
    await revokeCustomerTokensIn(tx, customer.id);

    log.info("customer_reset.consumed", { tenantId, customerId: customer.id });
    return { ok: true as const, customerId: customer.id };
  });
}

/** `venues.branding` is a Json blob; narrow it to the three keys the
 *  email shell knows about (same shape loyalty-service reads). */
function brandingOf(raw: unknown): {
  logoKey: string | null;
  bannerKey: string | null;
  primaryColor: string | null;
} {
  const b = (raw ?? {}) as { logoKey?: unknown; bannerKey?: unknown; primaryColor?: unknown };
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  return {
    logoKey: str(b.logoKey),
    bannerKey: str(b.bannerKey),
    primaryColor: str(b.primaryColor),
  };
}

/** Re-exported so pages and routes state the policy once. */
export { CUSTOMER_PASSWORD_MIN_LENGTH };
