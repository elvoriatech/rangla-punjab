import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "./auth-service";
import {
  registerCustomerWithPassword,
  signInCustomer,
  signInCustomerWithPassword,
  verifyCustomerToken,
} from "./customer-auth";
import {
  CUSTOMER_RESET_TTL_SECONDS,
  consumeCustomerPasswordReset,
  requestCustomerPasswordReset,
} from "./customer-password-reset";
import { prisma } from "./db";
import { env } from "./env";
import { asTenant } from "./tenant";
import { issueToken } from "./tokens";

/**
 * The guest reset flow, asserted where it actually matters:
 *
 *   - the request half is SILENT for anything that would reveal an
 *     account (unknown address, deleted row, Google sign-in) — silence
 *     here means "no token row", which is the only observable difference;
 *   - the consume half is single-use, TTL-bounded, tenant-scoped, and
 *     signs the guest out everywhere.
 *
 * The plaintext token never leaves the mail, so most tests mint their own
 * row with a known plaintext (exactly what the service does) and the full
 * mail round-trip is asserted once, gated on MailHog like `email.test.ts`.
 */

const PASSWORD = "S3cureP4ssPhrase!";
const NEW_PASSWORD = "n3wS3cureP4ss!";

interface MailhogItem {
  Content: { Headers: Record<string, string[]>; Body: string };
  To: { Mailbox: string; Domain: string }[];
}

/**
 * Undo the transfer encoding nodemailer applies: soft line breaks (`=\n`)
 * split long URLs, `=XX` hides every non-ASCII byte and the `=` of a query
 * string, and the HTML itself escapes `&`. Without this the assertions
 * below would be testing the encoder, not the link.
 */
function decodeQuotedPrintable(raw: string): string {
  const soft = raw.replace(/=\r?\n/g, "");
  const bytes = Buffer.from(
    soft.replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    ),
    "binary",
  );
  return bytes.toString("utf8").replaceAll("&amp;", "&");
}

async function fetchMailFor(recipient: string): Promise<MailhogItem[]> {
  const res = await fetch(`${env.MAILHOG_API_URL}/api/v2/messages`);
  if (!res.ok) throw new Error(`MailHog API returned ${res.status}`);
  const all = ((await res.json()) as { items: MailhogItem[] }).items;
  return all.filter((m) => `${m.To[0]!.Mailbox}@${m.To[0]!.Domain}` === recipient);
}

describe("guest password reset", () => {
  let tenantId: string;
  let otherTenantId: string;
  let userIds: string[] = [];
  const originalSlug = process.env.RESTAURANT_SLUG;

  beforeAll(async () => {
    const s = await signupUser({
      email: `reset-owner-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Reset Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userIds.push(s.userId);

    const other = await signupUser({
      email: `reset-other-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Reset Test Neighbour",
    });
    if (!other.ok) throw new Error("signup failed");
    otherTenantId = other.tenantId;
    userIds.push(other.userId);

    const slug = `reset-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Rangla Punjab", slug, currency: "EUR", defaultLocale: "de" },
      }),
    );
  });

  afterAll(async () => {
    for (const tid of [tenantId, otherTenantId]) {
      await asTenant(tid, (tx) => tx.customerPasswordResetToken.deleteMany({}));
      await asTenant(tid, (tx) => tx.customerToken.deleteMany({}));
      await asTenant(tid, (tx) => tx.customer.deleteMany({}));
      await asTenant(tid, (tx) => tx.venue.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds = [];
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
  });

  async function guestFixture(): Promise<{ email: string; customerId: string }> {
    const email = `guest-${randomUUID()}@ex.com`;
    const created = await registerCustomerWithPassword(tenantId, email, PASSWORD, "Amrit");
    if (!created.ok) throw new Error("register failed");
    return { email, customerId: created.value.customerId };
  }

  /** Mint a token row the way the service does, so a test can hold the
   *  plaintext without reading the guest's inbox. */
  async function mintToken(
    customerId: string,
    opts: { expiresAt?: Date; usedAt?: Date | null; tenant?: string } = {},
  ): Promise<string> {
    const token = issueToken();
    const tid = opts.tenant ?? tenantId;
    await asTenant(tid, (tx) =>
      tx.customerPasswordResetToken.create({
        data: {
          tenantId: tid,
          customerId,
          tokenHash: token.hash,
          expiresAt: opts.expiresAt ?? new Date(Date.now() + CUSTOMER_RESET_TTL_SECONDS * 1000),
          usedAt: opts.usedAt ?? null,
        },
      }),
    );
    return token.plaintext;
  }

  const tokenCount = (customerId: string): Promise<number> =>
    asTenant(tenantId, (tx) => tx.customerPasswordResetToken.count({ where: { customerId } }));

  it("issues a token for a password account", async () => {
    const { email, customerId } = await guestFixture();
    await requestCustomerPasswordReset(tenantId, email, { locale: "de" });
    expect(await tokenCount(customerId)).toBe(1);
  });

  it("matches the address case-insensitively and trims it", async () => {
    const { email, customerId } = await guestFixture();
    await requestCustomerPasswordReset(tenantId, `  ${email.toUpperCase()} `);
    expect(await tokenCount(customerId)).toBe(1);
  });

  it("stays silent for an unknown address, a Google account and a deleted one", async () => {
    // Unknown: nothing to count, so the assertion is that it does not throw
    // and writes no row at all for this tenant.
    const before = await asTenant(tenantId, (tx) => tx.customerPasswordResetToken.count());
    await requestCustomerPasswordReset(tenantId, `nobody-${randomUUID()}@ex.com`);

    const oauthEmail = `oauth-${randomUUID()}@ex.com`;
    const oauth = await signInCustomer(tenantId, "dev", {
      sub: `dev:${oauthEmail}`,
      email: oauthEmail,
      name: "Google Guest",
    });
    await requestCustomerPasswordReset(tenantId, oauthEmail);
    expect(await tokenCount(oauth.customerId)).toBe(0);

    const deleted = await guestFixture();
    await asTenant(tenantId, (tx) =>
      tx.customer.update({ where: { id: deleted.customerId }, data: { deletedAt: new Date() } }),
    );
    await requestCustomerPasswordReset(tenantId, deleted.email);
    expect(await tokenCount(deleted.customerId)).toBe(0);

    expect(await asTenant(tenantId, (tx) => tx.customerPasswordResetToken.count())).toBe(before);
  });

  it("sets the new password, marks the token used and signs every device out", async () => {
    const { email, customerId } = await guestFixture();
    const signedIn = await signInCustomerWithPassword(tenantId, email, PASSWORD);
    if (!signedIn.ok) throw new Error("sign-in failed");
    expect(await verifyCustomerToken(tenantId, signedIn.value.token)).not.toBeNull();

    const plaintext = await mintToken(customerId);
    const result = await consumeCustomerPasswordReset(tenantId, plaintext, NEW_PASSWORD);
    expect(result).toEqual({ ok: true, customerId });

    // The old password is gone, the new one works.
    expect((await signInCustomerWithPassword(tenantId, email, PASSWORD)).ok).toBe(false);
    expect((await signInCustomerWithPassword(tenantId, email, NEW_PASSWORD)).ok).toBe(true);
    // Every session minted before the reset is dead.
    expect(await verifyCustomerToken(tenantId, signedIn.value.token)).toBeNull();

    const row = await asTenant(tenantId, (tx) =>
      tx.customerPasswordResetToken.findFirst({ where: { customerId }, select: { usedAt: true } }),
    );
    expect(row?.usedAt).toBeInstanceOf(Date);
  });

  it("spends a token exactly once", async () => {
    const { customerId } = await guestFixture();
    const plaintext = await mintToken(customerId);
    expect((await consumeCustomerPasswordReset(tenantId, plaintext, NEW_PASSWORD)).ok).toBe(true);
    expect(await consumeCustomerPasswordReset(tenantId, plaintext, "an0therP4ssword!")).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });
  });

  it("refuses an expired token, a garbage token and a short password", async () => {
    const { customerId } = await guestFixture();
    const expired = await mintToken(customerId, { expiresAt: new Date(Date.now() - 1000) });
    expect(await consumeCustomerPasswordReset(tenantId, expired, NEW_PASSWORD)).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });
    expect(await consumeCustomerPasswordReset(tenantId, "not-a-token", NEW_PASSWORD)).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });
    const fresh = await mintToken(customerId);
    expect(await consumeCustomerPasswordReset(tenantId, fresh, "short")).toEqual({
      ok: false,
      error: "weak_password",
    });
    // The weak attempt must not have spent the token.
    expect((await consumeCustomerPasswordReset(tenantId, fresh, NEW_PASSWORD)).ok).toBe(true);
  });

  it("is tenant-scoped: another tenant cannot spend this token", async () => {
    const { email, customerId } = await guestFixture();
    const plaintext = await mintToken(customerId);
    expect(await consumeCustomerPasswordReset(otherTenantId, plaintext, NEW_PASSWORD)).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });
    // …and the password is untouched.
    expect((await signInCustomerWithPassword(tenantId, email, PASSWORD)).ok).toBe(true);
  });

  describe.runIf(env.EMAIL_TRANSPORT === "mailhog")("the emailed link", () => {
    it("carries a working, venue-branded, localised reset link", async () => {
      const { email, customerId } = await guestFixture();
      await requestCustomerPasswordReset(tenantId, email, {
        locale: "de",
        appReturnUrl: "ranglapunjab://auth-return",
      });

      const items = await fetchMailFor(email);
      expect(items).toHaveLength(1);
      const item = items[0]!;
      // The subject carries umlauts, so it arrives as an RFC 2047 encoded
      // word where spaces are underscores — match either spelling.
      expect(item.Content.Headers.Subject?.[0]).toMatch(/Rangla[_ ]Punjab/);
      const body = decodeQuotedPrintable(item.Content.Body);
      const match = /\/account\/reset\/([A-Za-z0-9_-]{20,})\?([^"\s]*)/.exec(body);
      expect(match, "the mail has a reset link").not.toBeNull();
      const [, plaintext, query] = match!;
      expect(query).toContain("locale=de");
      expect(query).toContain("app=ranglapunjab");
      expect(body).toContain("Neues Passwort wählen");

      const result = await consumeCustomerPasswordReset(tenantId, plaintext!, NEW_PASSWORD);
      expect(result).toEqual({ ok: true, customerId });
    });
  });
});
