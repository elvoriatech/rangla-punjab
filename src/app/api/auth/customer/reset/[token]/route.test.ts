import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import {
  registerCustomerWithPassword,
  signInCustomerWithPassword,
  verifyCustomerToken,
} from "@/lib/customer-auth";
import { CUSTOMER_RESET_TTL_SECONDS } from "@/lib/customer-password-reset";
import { prisma } from "@/lib/db";
import { asTenant } from "@/lib/tenant";
import { issueToken } from "@/lib/tokens";
import { POST } from "./route";

/**
 * Spending a guest reset token over the wire. The token never leaves the
 * email in real life, so the fixture mints the row itself — exactly what
 * the service does — and the test drives the route with the plaintext.
 */

const PASSWORD = "S3cureP4ssPhrase!";
const NEW_PASSWORD = "n3wS3cureP4ss!";

function post(token: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost:3000/api/auth/customer/reset/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

describe("POST /api/auth/customer/reset/[token]", () => {
  let tenantId: string;
  let userId: string;
  const originalSlug = process.env.RESTAURANT_SLUG;

  beforeAll(async () => {
    const s = await signupUser({
      email: `reset-token-${randomUUID()}@ex.com`,
      password: PASSWORD,
      tenantName: "Reset Token Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;

    const slug = `reset-token-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({ data: { tenantId, name: "Rangla Punjab", slug, currency: "EUR" } }),
    );
  });

  afterAll(async () => {
    await asTenant(tenantId, (tx) => tx.customerPasswordResetToken.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customerToken.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
  });

  async function fixture(expiresInMs = CUSTOMER_RESET_TTL_SECONDS * 1000): Promise<{
    email: string;
    customerId: string;
    plaintext: string;
    sessionToken: string;
  }> {
    const email = `guest-${randomUUID()}@ex.com`;
    const created = await registerCustomerWithPassword(tenantId, email, PASSWORD);
    if (!created.ok) throw new Error("register failed");
    const token = issueToken();
    await asTenant(tenantId, (tx) =>
      tx.customerPasswordResetToken.create({
        data: {
          tenantId,
          customerId: created.value.customerId,
          tokenHash: token.hash,
          expiresAt: new Date(Date.now() + expiresInMs),
        },
      }),
    );
    return {
      email,
      customerId: created.value.customerId,
      plaintext: token.plaintext,
      sessionToken: created.value.token,
    };
  }

  it("sets the password, signs every device out, and refuses the token twice", async () => {
    const { email, plaintext, sessionToken } = await fixture();

    const res = await post(plaintext, { password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    expect((await signInCustomerWithPassword(tenantId, email, NEW_PASSWORD)).ok).toBe(true);
    expect((await signInCustomerWithPassword(tenantId, email, PASSWORD)).ok).toBe(false);
    expect(await verifyCustomerToken(tenantId, sessionToken)).toBeNull();

    const again = await post(plaintext, { password: "y3tAnotherP4ss!" });
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ ok: false, error: "invalid_or_expired" });
  });

  it("410s an expired token and an invented one", async () => {
    const { plaintext } = await fixture(-1000);
    expect((await post(plaintext, { password: NEW_PASSWORD })).status).toBe(410);
    expect((await post("made-up-token-value", { password: NEW_PASSWORD })).status).toBe(410);
  });

  it("400s a password shorter than the sign-up policy, without spending the token", async () => {
    const { plaintext, email } = await fixture();
    const res = await post(plaintext, { password: "short" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid" });
    // Still spendable, and the old password still works until it is.
    expect((await signInCustomerWithPassword(tenantId, email, PASSWORD)).ok).toBe(true);
    expect((await post(plaintext, { password: NEW_PASSWORD })).status).toBe(200);
  });
});
