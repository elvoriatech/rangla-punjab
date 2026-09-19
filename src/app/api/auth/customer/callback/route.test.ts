import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { CUSTOMER_COOKIE, signState } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { siteUrl } from "@/lib/site-url";
import { asTenant } from "@/lib/tenant";
import { GET } from "./route";

/**
 * The end of the browser sign-in. Exercised through the `dev` provider
 * (its "code" IS the identity), so nothing here reaches Google.
 *
 * The behaviour under test is where the browser is sent afterwards: back
 * into the app when the device code carries a return deep link, and to
 * the web account page in every other case.
 */

describe("GET /api/auth/customer/callback", () => {
  let tenantId: string;
  let userId: string;
  const originalSlug = process.env.RESTAURANT_SLUG;

  beforeAll(async () => {
    const s = await signupUser({
      email: `cb-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Callback Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    const slug = `cb-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Callback Venue", slug, currency: "EUR" },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.customerToken.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** Park a device code the way POST /api/v1/auth/device does. */
  async function device(entry: Record<string, unknown>): Promise<string> {
    const code = `t${randomUUID().replace(/-/g, "").slice(0, 9)}`;
    await redis.set(`customer-device:${code}`, JSON.stringify(entry), "EX", 600);
    return code;
  }

  function callback(deviceCode?: string): NextRequest {
    const identity = Buffer.from(
      JSON.stringify({ email: `guest-${randomUUID()}@ex.com`, name: "Guest" }),
    ).toString("base64url");
    const state = signState({ p: "dev", ...(deviceCode ? { d: deviceCode } : {}) });
    return new NextRequest(
      `http://localhost:3000/api/auth/customer/callback?state=${encodeURIComponent(state)}&code=${identity}`,
    );
  }

  it("sends the browser back into the app when the code carries a deep link", async () => {
    const code = await device({ status: "pending", app: "ranglapunjab://auth-return" });
    const res = await GET(callback(code));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `${siteUrl()}/auth/app-return?to=ranglapunjab%3A%2F%2Fauth-return`,
    );
    // The web session still rides along on the same response.
    expect(res.cookies.get(CUSTOMER_COOKIE)?.value).toBeTruthy();
  });

  it("parks the token for the app's poll, and nothing else", async () => {
    const code = await device({ status: "pending", app: "ranglapunjab://auth-return" });
    await GET(callback(code));

    const parked = JSON.parse((await redis.get(`customer-device:${code}`)) ?? "null") as Record<
      string,
      unknown
    >;
    expect(parked.status).toBe("ok");
    expect(typeof parked.token).toBe("string");
    expect(parked.customer).toBeTruthy();
    // The app's own return link has done its job — it is not handed back.
    expect(parked.app).toBeUndefined();
  });

  it("keeps the old web landing when the code carries no deep link", async () => {
    const code = await device({ status: "pending" });
    const res = await GET(callback(code));

    expect(res.headers.get("location")).toBe(`${siteUrl()}/account?welcome=1&app=1`);
  });

  it("refuses a parked link that is not an app scheme", async () => {
    const code = await device({ status: "pending", app: "https://evil.example.com/steal" });
    const res = await GET(callback(code));

    expect(res.headers.get("location")).toBe(`${siteUrl()}/account?welcome=1&app=1`);
  });

  it("leaves a plain web sign-in on the account page", async () => {
    const res = await GET(callback());

    expect(res.headers.get("location")).toBe(`${siteUrl()}/account?welcome=1`);
  });
});
