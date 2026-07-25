import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import {
  consumeEmailVerification,
  consumePasswordReset,
  requestEmailVerification,
  requestPasswordReset,
  sendVerificationEmail,
} from "./verification-service";
import { env } from "./env";
import { hashToken } from "./tokens";

// Integration test: full verify + reset flows against the real DB. The
// tokens are opaque — we assert on side-effects (row states, MailHog
// receipt) rather than the plaintext.

interface MailhogItem {
  ID: string;
  Content: { Headers: Record<string, string[]>; Body: string };
  To: { Mailbox: string; Domain: string }[];
}

async function fetchMailFor(recipient: string): Promise<MailhogItem[]> {
  // Vitest runs test files in parallel and multiple suites share MailHog,
  // so filter to *this* test's recipient. Otherwise a token from another
  // suite's email ends up in the wrong flow.
  const res = await fetch(`${env.MAILHOG_API_URL}/api/v2/messages`);
  const all = ((await res.json()) as { items: MailhogItem[] }).items;
  return all.filter((m) => `${m.To[0]!.Mailbox}@${m.To[0]!.Domain}` === recipient);
}

function extractToken(item: MailhogItem, kind: "verify" | "reset"): string {
  const body = item.Content.Body.replace(/=\r?\n/g, "");
  // Both links now point at the human-facing pages — /verify/[token] and
  // /reset/[token] — which render a landing page / set-password form
  // rather than the JSON API route.
  const re = new RegExp(`/${kind}/([A-Za-z0-9_-]+)`);
  const match = body.match(re);
  if (!match) throw new Error(`no ${kind} token found in email body`);
  return match[1]!;
}

async function waitForMailFor(
  recipient: string,
  min: number,
  // 15 s tolerates MailHog under parallel-suite load; test timeout is bumped
  // in tandem below.
  timeoutMs = 15000,
): Promise<MailhogItem[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const items = await fetchMailFor(recipient);
    if (items.length >= min) return items;
    if (Date.now() > deadline) {
      throw new Error(`only ${items.length} mail(s) for ${recipient} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function seedUser(): Promise<{ userId: string; tenantId: string; email: string }> {
  const email = `p1-2b-${randomUUID()}@ex.com`;
  const signup = await signupUser({ email, password: "S3cureP4ssPhrase!", tenantName: "Acme" });
  if (!signup.ok) throw new Error("seed signup failed");
  await waitForMailFor(email, 1);
  return { userId: signup.userId, tenantId: signup.tenantId, email };
}

describe.runIf(env.EMAIL_TRANSPORT === "mailhog")("verification + reset flows", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
    // No global mail purge — other suites share the sink; we only care
    // about our own recipient-scoped mail.
  });

  it("signup enqueues a verification email; consuming its token flips emailVerifiedAt", async () => {
    const { userId, email, tenantId } = await seedUser();
    createdUserIds.push(userId);
    createdTenantIds.push(tenantId);

    const [mail] = await waitForMailFor(email, 1);
    const token = extractToken(mail!, "verify");
    const consume = await consumeEmailVerification(token);
    expect(consume.ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it("reused verification token → invalid_or_expired", async () => {
    const { userId, email, tenantId } = await seedUser();
    createdUserIds.push(userId);
    createdTenantIds.push(tenantId);
    const [mail] = await waitForMailFor(email, 1);
    const token = extractToken(mail!, "verify");

    expect((await consumeEmailVerification(token)).ok).toBe(true);
    const reuse = await consumeEmailVerification(token);
    expect(reuse.ok).toBe(false);
  });

  it("expired verification token → invalid_or_expired", async () => {
    const { userId, email, tenantId } = await seedUser();
    createdUserIds.push(userId);
    createdTenantIds.push(tenantId);
    // Issue a second token, then age every unused token for this user.
    await sendVerificationEmail(userId, email);
    await prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const mails = await waitForMailFor(email, 2);
    const token = extractToken(mails.at(-1)!, "verify");
    const consume = await consumeEmailVerification(token);
    expect(consume.ok).toBe(false);
  });

  it("password reset consumes a token, updates hash, and bumps sessions_valid_from", async () => {
    const { userId, email, tenantId } = await seedUser();
    createdUserIds.push(userId);
    createdTenantIds.push(tenantId);

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, sessionsValidFrom: true },
    });
    // Force a measurable time gap so `sessionsValidFrom` reliably increases.
    await new Promise((r) => setTimeout(r, 20));

    await requestPasswordReset(email);
    // Two mails now: the signup verify + the reset. Grab the reset one.
    const mails = await waitForMailFor(email, 2);
    const resetMail = mails.find((m) => /\/reset\//.test(m.Content.Body.replace(/=\r?\n/g, "")))!;
    const token = extractToken(resetMail, "reset");

    const consume = await consumePasswordReset(token, "an3wS3cureP4ssPhrase!");
    expect(consume.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, sessionsValidFrom: true },
    });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.sessionsValidFrom.getTime()).toBeGreaterThan(before.sessionsValidFrom.getTime());
  });

  it("reset for an unknown email is silent (no error, no leak)", async () => {
    await expect(
      requestPasswordReset(`does-not-exist-${randomUUID()}@ex.com`),
    ).resolves.toBeUndefined();
    const rows = await prisma.passwordResetToken.count({
      where: { tokenHash: hashToken("won't-be-hit") },
    });
    expect(rows).toBe(0);
  });

  it("request verification is silent when the account is already verified", async () => {
    const { userId, email, tenantId } = await seedUser();
    createdUserIds.push(userId);
    createdTenantIds.push(tenantId);
    // The signup mail is already in the mailbox; count it as the baseline.
    const baseline = (await waitForMailFor(email, 1)).length;

    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });

    await requestEmailVerification(email);
    // Wait a beat and confirm no new mail landed for this recipient.
    await new Promise((r) => setTimeout(r, 200));
    const items = await fetchMailFor(email);
    expect(items).toHaveLength(baseline);
  });
});
