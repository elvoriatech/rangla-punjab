import { siteUrl } from "./site-url";
import { BRAND } from "./brand";
import { prisma } from "./db";
import { sendEmail } from "./email";
import { VerifyEmail } from "@/emails/verify-email";
import { ResetPasswordEmail } from "@/emails/reset-password-email";
import { hashPassword } from "./password";
import { hashToken, issueToken } from "./tokens";

/**
 * Email verification and password reset flows share the same token shape:
 * a random 32-byte base64url string, stored hashed, single-use, TTL-bounded.
 * Keeping both in one file avoids code duplication in what is really the
 * same primitive with two consumer effects.
 */

const VERIFY_TTL_SECONDS = 60 * 60 * 24; // 24 h
const RESET_TTL_SECONDS = 60 * 60; //       1 h

/**
 * Base URL used to build outgoing token links. Not required in env because
 * dev + test derive it from the compose host mapping; prod overrides via
 * `APP_URL` (added implicitly here — env schema will pick it up when the
 * public deploy task lands).
 */
function baseUrl(): string {
  return siteUrl();
}

// ---------- Email verification ----------

export type ConsumeResult =
  { ok: true; userId: string } | { ok: false; error: "invalid_or_expired" };

/**
 * Issue a verification token for the given email if the user exists and is
 * not already verified. Always responds success at the route layer — this
 * function returning `false` just skips the send so a caller doesn't leak
 * account existence via response body or timing.
 */
export async function requestEmailVerification(email: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim(), deletedAt: null, emailVerifiedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return;
  await sendVerificationEmail(user.id, user.email);
}

/**
 * Internal: issue and send a verification token. Called from signup so the
 * user gets a mail immediately, and from the `verify/request` route.
 */
export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = issueToken();
  const expiresAt = new Date(Date.now() + VERIFY_TTL_SECONDS * 1000);
  await prisma.emailVerificationToken.create({
    data: { tokenHash: token.hash, userId, expiresAt },
  });
  // Human-facing page (confirms + shows "continue"), not the raw JSON
  // API route — that one stays only for pre-existing emails.
  const verifyUrl = `${baseUrl()}/verify/${token.plaintext}`;
  await sendEmail({
    to: email,
    subject: `Confirm your ${BRAND.name} email`,
    react: VerifyEmail({ verifyUrl }),
  });
}

export async function consumeEmailVerification(plaintext: string): Promise<ConsumeResult> {
  const hash = hashToken(plaintext);
  const now = new Date();
  const token = await prisma.emailVerificationToken.findFirst({
    where: { tokenHash: hash, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  });
  if (!token) return { ok: false, error: "invalid_or_expired" };

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: token.id },
      data: { usedAt: now },
    }),
    prisma.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: now },
    }),
  ]);
  return { ok: true, userId: token.userId };
}

// ---------- Password reset ----------

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim(), deletedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return;
  const token = issueToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_SECONDS * 1000);
  await prisma.passwordResetToken.create({
    data: { tokenHash: token.hash, userId: user.id, expiresAt },
  });
  const resetUrl = `${baseUrl()}/reset/${token.plaintext}`;
  await sendEmail({
    to: user.email,
    subject: `Reset your ${BRAND.name} password`,
    react: ResetPasswordEmail({ resetUrl }),
  });
}

export async function consumePasswordReset(
  plaintext: string,
  newPassword: string,
): Promise<ConsumeResult> {
  const hash = hashToken(plaintext);
  const now = new Date();
  const token = await prisma.passwordResetToken.findFirst({
    where: { tokenHash: hash, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  });
  if (!token) return { ok: false, error: "invalid_or_expired" };

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: now },
    }),
    prisma.user.update({
      where: { id: token.userId },
      // Bumping `sessions_valid_from` invalidates every outstanding cookie
      // for this user — that is the point of a reset flow.
      data: { passwordHash, sessionsValidFrom: now },
    }),
  ]);
  return { ok: true, userId: token.userId };
}
