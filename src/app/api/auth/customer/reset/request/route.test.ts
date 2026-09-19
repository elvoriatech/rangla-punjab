import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword, signInCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { asTenant } from "@/lib/tenant";
import { POST } from "./route";

/**
 * The enumeration guarantee, asserted at the wire level: a known address,
 * an unknown one and a Google account all get the SAME `200 {ok:true}`.
 * The only difference is invisible from outside — whether a token row
 * exists — which is what each case checks in the database.
 */

const PASSWORD = "S3cureP4ssPhrase!";

/** A fresh IP per call: the reset limiter is 3/hour per IP and fails
 *  CLOSED, so a shared IP would turn this suite into a 429 machine. */
function post(body: unknown): Promise<Response> {
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  return POST(
    new Request("http://localhost:3000/api/auth/customer/reset/request", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/auth/customer/reset/request", () => {
  let tenantId: string;
  let userId: string;
  const originalSlug = process.env.RESTAURANT_SLUG;

  beforeAll(async () => {
    const s = await signupUser({
      email: `reset-req-${randomUUID()}@ex.com`,
      password: PASSWORD,
      tenantName: "Reset Request Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;

    const slug = `reset-req-${randomUUID().slice(0, 8)}`;
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

  const tokensFor = (customerId: string): Promise<number> =>
    asTenant(tenantId, (tx) => tx.customerPasswordResetToken.count({ where: { customerId } }));

  it("answers 200 and issues a token for a password account", async () => {
    const email = `guest-${randomUUID()}@ex.com`;
    const created = await registerCustomerWithPassword(tenantId, email, PASSWORD);
    if (!created.ok) throw new Error("register failed");

    const res = await post({ email, locale: "de" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await tokensFor(created.value.customerId)).toBe(1);
  });

  it("answers the same 200 for an unknown address and a Google account", async () => {
    const unknown = await post({ email: `nobody-${randomUUID()}@ex.com` });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: true });

    const oauthEmail = `oauth-${randomUUID()}@ex.com`;
    const oauth = await signInCustomer(tenantId, "dev", {
      sub: `dev:${oauthEmail}`,
      email: oauthEmail,
      name: "Google Guest",
    });
    const res = await post({ email: oauthEmail });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await tokensFor(oauth.customerId)).toBe(0);
  });

  it("400s a malformed body", async () => {
    const res = await post({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid" });
  });

  it("429s once the per-address limit is spent, whatever the IP", async () => {
    const email = `flood-${randomUUID()}@ex.com`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await post({ email })).status);
    // 3 per hour per address (RESET_EMAIL), so the tail must be 429s.
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
  });
});
