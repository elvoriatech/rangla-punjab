import { randomUUID } from "node:crypto";
import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { setAppleIdTokenConfigForTests } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { asTenant } from "@/lib/tenant";
import { GET as ME } from "../../../v1/me/route";
import { POST } from "./route";

/**
 * Sign in with Apple from the iOS app. Tokens are signed with a local key
 * pair the verifier is pointed at, so nothing here reaches appleid.apple.com.
 * The Apple-specific part worth pinning: the name arrives only on the
 * first sign-in and the email may be missing later — neither may be wiped.
 */

const AUD = "de.ranglapunjabrestaurant.app";

describe("POST /api/auth/customer/apple", () => {
  let tenantId: string;
  let userId: string;
  let keyPair: { privateKey: CryptoKey; verify: JWTVerifyGetKey };
  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    keyPair = { privateKey: pair.privateKey, verify: async () => pair.publicKey };

    const s = await signupUser({
      email: `apple-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Apple Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    const slug = `apple-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;
    await asTenant(tenantId, (tx) =>
      tx.venue.create({
        data: { tenantId, name: "Apple Venue", slug, currency: "EUR" },
        select: { id: true },
      }),
    );
  });

  afterEach(() => setAppleIdTokenConfigForTests(null));

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function configure(): void {
    setAppleIdTokenConfigForTests({ audiences: [AUD], keys: keyPair.verify });
  }

  async function idToken(
    claims: Record<string, unknown>,
    opts: { aud?: string; iss?: string } = {},
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(opts.iss ?? "https://appleid.apple.com")
      .setAudience(opts.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(keyPair.privateKey);
  }

  function request(body: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/auth/customer/apple", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });
  }

  interface SignInBody {
    token: string;
    customer: { id: string; email: string; name: string | null };
  }

  it("400s a body without an idToken", async () => {
    configure();
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ idToken: "short" }))).status).toBe(400);
  });

  it("401s another app's audience and a non-Apple issuer", async () => {
    configure();
    const wrongAud = await POST(
      request({ idToken: await idToken({ sub: "x" }, { aud: "com.someone.else" }) }),
    );
    expect(wrongAud.status).toBe(401);
    expect(await wrongAud.json()).toEqual({ error: "invalid_token" });
    const wrongIss = await POST(
      request({ idToken: await idToken({ sub: "x" }, { iss: "https://accounts.google.com" }) }),
    );
    expect(wrongIss.status).toBe(401);
  });

  it("signs a guest in with a relay email, and keeps name + email on later sign-ins", async () => {
    configure();
    const sub = `apple-sub-${randomUUID()}`;
    const relay = `${randomUUID().slice(0, 8)}@privaterelay.appleid.com`;

    const first = await POST(
      request({
        idToken: await idToken({ sub, email: relay, email_verified: "true" }),
        name: "Sana Apple",
      }),
    );
    expect(first.status).toBe(200);
    const one = (await first.json()) as SignInBody;
    expect(one.customer).toMatchObject({ email: relay, name: "Sana Apple" });

    const me = await ME(
      new NextRequest("http://localhost:3000/api/v1/me", {
        headers: { "x-customer-token": one.token, "x-forwarded-for": ip },
      }),
    );
    expect(me.status).toBe(200);

    // Apple's second sign-in: no name, and here no email either.
    const again = await POST(request({ idToken: await idToken({ sub }) }));
    expect(again.status).toBe(200);
    const two = (await again.json()) as SignInBody;
    expect(two.customer.id).toBe(one.customer.id);
    expect(two.customer).toMatchObject({ email: relay, name: "Sana Apple" });
  });

  it("never stores an email the token does not mark as verified", async () => {
    configure();
    const res = await POST(
      request({
        idToken: await idToken({
          sub: `apple-sub-${randomUUID()}`,
          email: "unverified@ex.com",
          email_verified: false,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SignInBody;
    expect(body.customer.email).toBe("");
  });
});
