import { randomUUID } from "node:crypto";
import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { setGoogleIdTokenConfigForTests, signInCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { asTenant } from "@/lib/tenant";
import { GET as ME } from "../../../v1/me/route";
import { POST } from "./route";

/**
 * Native one-tap sign-in. The suite signs its own ID tokens with a local
 * key pair and points the verifier at it, so nothing here touches
 * googleapis.com — the only thing left untested is the network fetch of
 * Google's real JWKS.
 */

const AUD = "111-web.apps.googleusercontent.com";

describe("POST /api/auth/customer/google", () => {
  let tenantId: string;
  let userId: string;
  let keyPair: { privateKey: CryptoKey; verify: JWTVerifyGetKey };
  const originalSlug = process.env.RESTAURANT_SLUG;
  // Distinct per run: the device-flow rate limiter is 20/hour per IP and
  // its Redis buckets outlive the test process.
  const ip = `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    keyPair = { privateKey: pair.privateKey, verify: async () => pair.publicKey };

    const s = await signupUser({
      email: `goog-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Google Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    const slug = `goog-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Google Venue", slug, currency: "EUR" },
        select: { id: true },
      }),
    );
  });

  afterEach(() => setGoogleIdTokenConfigForTests(null));

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function configure(audiences: string[] = [AUD]): void {
    setGoogleIdTokenConfigForTests({ audiences, keys: keyPair.verify });
  }

  async function idToken(claims: Record<string, unknown>, aud: string = AUD): Promise<string> {
    return new SignJWT({ email_verified: true, ...claims })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://accounts.google.com")
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keyPair.privateKey);
  }

  function request(body: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/auth/customer/google", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });
  }

  it("503s when no Google client id is configured", async () => {
    // vitest.setup strips GOOGLE_CLIENT_ID, so this is the real default.
    const res = await POST(request({ idToken: await idToken({ sub: "a", email: "a@ex.com" }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "google_not_configured" });
  });

  it("400s a body without an idToken", async () => {
    configure();
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ idToken: "short" }))).status).toBe(400);
  });

  it("401s another app's audience and an unverified address", async () => {
    configure();
    const wrongAud = await POST(
      request({
        idToken: await idToken(
          { sub: "b", email: "b@ex.com" },
          "someone-else.apps.googleusercontent.com",
        ),
      }),
    );
    expect(wrongAud.status).toBe(401);
    expect(await wrongAud.json()).toEqual({ error: "invalid_token" });

    const unverified = await POST(
      request({ idToken: await idToken({ sub: "c", email: "c@ex.com", email_verified: false }) }),
    );
    expect(unverified.status).toBe(401);
  });

  it("signs a guest in, and the token it hands back works on /api/v1/me", async () => {
    configure([AUD, "222-ios.apps.googleusercontent.com"]);
    const res = await POST(
      request({
        idToken: await idToken(
          { sub: "google-sub-42", email: "one.tap@ex.com", name: "One Tap" },
          "222-ios.apps.googleusercontent.com",
        ),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      customer: {
        id: string;
        email: string;
        name: string | null;
        phone: string | null;
        lastDeliveryAddress: unknown;
      };
    };
    expect(body.token).toBeTruthy();
    expect(body.customer).toMatchObject({
      email: "one.tap@ex.com",
      name: "One Tap",
      phone: null,
      lastDeliveryAddress: null,
    });

    const me = await ME(
      new NextRequest("http://localhost:3000/api/v1/me", {
        headers: { "x-customer-token": body.token, "x-forwarded-for": ip },
      }),
    );
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { customer: { id: string; email: string } };
    expect(meBody.customer.id).toBe(body.customer.id);
    expect(meBody.customer.email).toBe("one.tap@ex.com");
  });

  it("lands on the SAME customer row as the browser flow (same Google sub)", async () => {
    // The browser hop signed this guest in first.
    const browser = await signInCustomer(tenantId, "google", {
      sub: "google-sub-77",
      email: "both@ex.com",
      name: "Both Ways",
    });
    configure();

    const res = await POST(
      request({ idToken: await idToken({ sub: "google-sub-77", email: "both@ex.com" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; customer: { id: string } };
    expect(body.customer.id).toBe(browser.customerId); // no duplicate account
    expect(body.token).not.toBe(browser.token); // but a fresh token
  });
});
