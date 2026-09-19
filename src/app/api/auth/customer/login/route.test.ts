import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { verifySession } from "@/lib/session";
import { asTenant } from "@/lib/tenant";
import { POST } from "./route";

/**
 * One sign-in form, two kinds of account. Asserted at the wire level
 * because the mobile app branches on `kind` to decide whether it is
 * showing a menu or an orders board — and because the failure body must
 * stay one indistinguishable 401 no matter which kind of account (if
 * any) the address belongs to.
 */

interface LoginBody {
  kind?: string;
  token?: string;
  error?: string;
  customer?: { email: string; name: string | null };
  restaurant?: { name: string; email: string };
}

const PASSWORD = "S3cureP4ssPhrase!";
const OWNER_PASSWORD = "0wnerP4ssPhrase!";

describe("POST /api/auth/customer/login", () => {
  let tenantId: string;
  let ownerUserId: string;
  let strayUserId: string;
  let ownerEmail: string;
  let strayEmail: string;
  let guestEmail: string;
  let sharedEmail: string;
  const originalSlug = process.env.RESTAURANT_SLUG;

  beforeAll(async () => {
    ownerEmail = `owner-${randomUUID()}@ex.com`;
    strayEmail = `stray-${randomUUID()}@ex.com`;
    guestEmail = `guest-${randomUUID()}@ex.com`;
    sharedEmail = `both-${randomUUID()}@ex.com`;

    const s = await signupUser({
      email: ownerEmail,
      password: OWNER_PASSWORD,
      tenantName: "Staff Login Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    ownerUserId = s.userId;

    // A real user with a real password but NO membership here — the
    // "correct password, wrong person" case.
    const stray = await prisma.user.create({
      data: { email: strayEmail, passwordHash: await hashPassword(OWNER_PASSWORD) },
      select: { id: true },
    });
    strayUserId = stray.id;

    const slug = `staff-login-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({ data: { tenantId, name: "Rangla Punjab", slug, currency: "EUR" } }),
    );

    await registerCustomerWithPassword(tenantId, guestEmail, PASSWORD, "Amrit");
    // Same address as the owner-style account below, to prove precedence.
    await registerCustomerWithPassword(tenantId, sharedEmail, PASSWORD, "Guest Twin");
    await prisma.user.create({
      data: { email: sharedEmail, passwordHash: await hashPassword(PASSWORD) },
    });
    // ...and give that twin the owner membership, so the ONLY reason the
    // guest wins is precedence, not a failed restaurant login.
    const twin = await prisma.user.findFirstOrThrow({
      where: { email: sharedEmail },
      select: { id: true },
    });
    await asTenant(tenantId, (tx) =>
      tx.membership.create({ data: { userId: twin.id, tenantId, role: "owner" } }),
    );
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.customerToken.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, strayEmail, sharedEmail] } },
    });
  });

  /** A fresh IP per call: the login limiter is 5/min per IP and fails
   *  CLOSED, so a shared IP would turn this suite into a 429 machine. */
  function login(email: string, password: string): Promise<Response> {
    const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    return POST(
      new Request("http://localhost:3000/api/auth/customer/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email, password }),
      }),
    );
  }

  it("signs a guest in with kind:guest and the unchanged body", async () => {
    const res = await login(guestEmail, PASSWORD);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LoginBody;
    expect(body.kind).toBe("guest");
    expect(body.customer).toEqual({ email: guestEmail, name: "Amrit" });
    expect(typeof body.token).toBe("string");
    // A guest token is an opaque random string, never a signed session.
    expect(verifySession(body.token!)).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("signs the restaurant in with kind:restaurant and a session token", async () => {
    const res = await login(ownerEmail, OWNER_PASSWORD);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LoginBody;
    expect(body.kind).toBe("restaurant");
    expect(body.restaurant).toEqual({ name: "Rangla Punjab", email: ownerEmail });
    expect(verifySession(body.token!)?.userId).toBe(ownerUserId);
    // The restaurant answer must not leak a guest shape.
    expect(body.customer).toBeUndefined();
  });

  it("refuses a real user who holds no owner membership here", async () => {
    const res = await login(strayEmail, OWNER_PASSWORD);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
    expect(strayUserId).toBeTypeOf("string");
  });

  it("refuses a wrong password with the same generic 401", async () => {
    const wrongGuest = await login(guestEmail, "not-the-password");
    const wrongOwner = await login(ownerEmail, "not-the-password");
    const unknown = await login(`nobody-${randomUUID()}@ex.com`, PASSWORD);
    for (const res of [wrongGuest, wrongOwner, unknown]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_credentials" });
    }
  });

  it("gives the guest account precedence when both exist", async () => {
    const res = await login(sharedEmail, PASSWORD);
    const body = (await res.json()) as LoginBody;
    expect(body.kind).toBe("guest");
    expect(body.customer?.name).toBe("Guest Twin");
  });

  it("400s a malformed body without touching either account store", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/auth/customer/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.7.99.99" },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid" });
  });
});
