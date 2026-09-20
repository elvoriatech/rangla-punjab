import { randomUUID } from "node:crypto";
import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import {
  customerProviders,
  exchangeCode,
  googleIdTokenAudiences,
  revokeCustomerToken,
  setGoogleIdTokenConfigForTests,
  signInCustomer,
  signState,
  updateCustomerProfile,
  verifyCustomerToken,
  verifyGoogleIdToken,
  verifyState,
} from "./customer-auth";
import { placeOrder } from "./order-service";

describe("customer auth (Google/Microsoft sign-in plumbing)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.customer.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  async function tenantFixture(): Promise<string> {
    const s = await signupUser({
      email: `cust-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Cust Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);
    return s.tenantId;
  }

  it("dev provider is available outside production; real ones need credentials", () => {
    const ids = customerProviders().map((p) => p.id);
    expect(ids).toContain("dev"); // NODE_ENV=test
    expect(ids).not.toContain("google"); // creds stripped in vitest.setup
    expect(ids).not.toContain("microsoft");
  });

  it("state roundtrips, is tamper-proof, and expires", () => {
    const state = signState({ p: "dev", d: "abc123" });
    const verified = verifyState(state);
    expect(verified).toMatchObject({ p: "dev", d: "abc123" });
    expect(verifyState(state.slice(0, -2) + "xx")).toBeNull();
    expect(verifyState("garbage")).toBeNull();
  });

  it("dev code exchange decodes the identity and rejects junk", async () => {
    const dev = customerProviders().find((p) => p.id === "dev")!;
    const code = Buffer.from(JSON.stringify({ email: "gast@ex.com", name: "Gast" })).toString(
      "base64url",
    );
    expect(await exchangeCode(dev, code)).toEqual({
      sub: "dev:gast@ex.com",
      email: "gast@ex.com",
      name: "Gast",
    });
    expect(await exchangeCode(dev, "not-base64-json")).toBeNull();
  });

  it("sign-in upserts by (provider, sub), mints a working token; revoke kills it", async () => {
    const tenantId = await tenantFixture();
    const first = await signInCustomer(tenantId, "dev", {
      sub: "dev:k@ex.com",
      email: "k@ex.com",
      name: "Khan",
    });
    const second = await signInCustomer(tenantId, "dev", {
      sub: "dev:k@ex.com",
      email: "k@ex.com",
      name: "Khan Renamed",
    });
    expect(second.customerId).toBe(first.customerId); // same identity, no dup
    expect(second.name).toBe("Khan Renamed"); // display refreshed

    const verified = await verifyCustomerToken(tenantId, second.token);
    expect(verified).toMatchObject({ id: first.customerId, email: "k@ex.com" });
    // both tokens work until revoked
    expect(await verifyCustomerToken(tenantId, first.token)).not.toBeNull();

    await revokeCustomerToken(tenantId, second.token);
    expect(await verifyCustomerToken(tenantId, second.token)).toBeNull();
    expect(await verifyCustomerToken(tenantId, first.token)).not.toBeNull();
    expect(await verifyCustomerToken(tenantId, "bogus-token-bogus-token")).toBeNull();
  });

  /** Minimal venue + published item, enough for placeOrder. */
  async function venueFixture(tenantId: string): Promise<{
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    return asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId, name: "V", slug: `cust-${randomUUID().slice(0, 8)}`, currency: "EUR" },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const version = await tx.menuVersion.create({
        data: { tenantId, menuId: menu.id, status: "published", publishedAt: new Date() },
        select: { id: true },
      });
      await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
      const cat = await tx.category.create({
        data: { tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
        select: { id: true },
      });
      const item = await tx.item.create({
        data: { tenantId, categoryId: cat.id, name: "Dal", priceCents: 890, orderIndex: 0 },
        select: { id: true },
      });
      return { tenantId, venueId: venue.id, publishedVersionId: version.id, itemId: item.id };
    });
  }

  it("orders placed with a customer are linked and listable for that customer only", async () => {
    const tenantId = await tenantFixture();
    const fx = await venueFixture(tenantId);

    const me = await signInCustomer(tenantId, "dev", {
      sub: "dev:me@ex.com",
      email: "me@ex.com",
      name: "Me",
    });
    const linked = await placeOrder(
      fx,
      { orderType: "dine_in", items: [{ itemId: fx.itemId, quantity: 1 }] },
      { customerId: me.customerId },
    );
    const anonymous = await placeOrder(fx, {
      orderType: "dine_in",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!linked.ok || !anonymous.ok) throw new Error("orders failed");

    const mine = await asTenant(tenantId, (tx) =>
      tx.order.findMany({ where: { customerId: me.customerId }, select: { id: true } }),
    );
    expect(mine.map((o) => o.id)).toEqual([linked.value.orderId]);
  });

  it("carries the checkout profile through sign-in, edits and clears", async () => {
    const tenantId = await tenantFixture();
    const me = await signInCustomer(tenantId, "dev", {
      sub: "dev:p@ex.com",
      email: "p@ex.com",
      name: "Pia",
    });
    expect(me.customer).toEqual({
      id: me.customerId,
      email: "p@ex.com",
      name: "Pia",
      phone: null,
      lastDeliveryAddress: null,
      // A brand-new account has no language of its own — the app then
      // falls back to the venue's default.
      locale: null,
    });

    const saved = await updateCustomerProfile(tenantId, me.customerId, {
      phone: "  0170 1234567  ",
      lastDeliveryAddress: { street: "Hauptstr. 3", zip: "60311", city: "Frankfurt" },
    });
    expect(saved).toMatchObject({
      name: "Pia", // untouched keys stay untouched
      phone: "0170 1234567", // trimmed
      lastDeliveryAddress: { street: "Hauptstr. 3", zip: "60311", city: "Frankfurt" },
    });

    // The token verifier serves the same profile — that's what /me reads.
    expect(await verifyCustomerToken(tenantId, me.token)).toMatchObject({
      phone: "0170 1234567",
      lastDeliveryAddress: { zip: "60311" },
    });

    // Signing in again must not wipe what the guest typed at checkout.
    await signInCustomer(tenantId, "dev", { sub: "dev:p@ex.com", email: "p@ex.com", name: "Pia" });
    expect(await verifyCustomerToken(tenantId, me.token)).toMatchObject({
      phone: "0170 1234567",
    });

    // Explicit null = "forget where I live"; SQL NULL, not JSON null.
    const cleared = await updateCustomerProfile(tenantId, me.customerId, {
      lastDeliveryAddress: null,
    });
    expect(cleared?.lastDeliveryAddress).toBeNull();
    expect(cleared?.phone).toBe("0170 1234567");

    // A customer id from another tenant updates nothing (RLS).
    const otherTenantId = await tenantFixture();
    expect(
      await updateCustomerProfile(otherTenantId, me.customerId, { name: "Hijack" }),
    ).toBeNull();
    expect((await verifyCustomerToken(tenantId, me.token))?.name).toBe("Pia");
  });

  it("an order back-fills the customer profile — delivery writes, dine-in never clears", async () => {
    const tenantId = await tenantFixture();
    const fx = await venueFixture(tenantId);
    await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      await tx.venue.update({
        where: { id: fx.venueId },
        data: { ordering: { delivery: true, deliveryZips: ["60311"], deliveryFeeCents: 200 } },
      });
    });
    const me = await signInCustomer(tenantId, "dev", {
      sub: "dev:b@ex.com",
      email: "b@ex.com",
      name: "Old Name",
    });

    const delivered = await placeOrder(
      fx,
      {
        orderType: "delivery",
        items: [{ itemId: fx.itemId, quantity: 1 }],
        customerName: "Bilal",
        customerPhone: "0170 999",
        address: { street: "Weg 1", zip: "60311", city: "Frankfurt", note: "2. Stock" },
      },
      { customerId: me.customerId },
    );
    if (!delivered.ok) throw new Error("delivery order failed");

    expect(await verifyCustomerToken(tenantId, me.token)).toMatchObject({
      name: "Bilal", // "last used" wins over the IdP's display name
      phone: "0170 999",
      lastDeliveryAddress: {
        street: "Weg 1",
        zip: "60311",
        city: "Frankfurt",
        note: "2. Stock",
      },
    });

    // Dine-in carries no contact fields at all — it must leave the
    // profile exactly as the delivery left it.
    const dineIn = await placeOrder(
      fx,
      { orderType: "dine_in", items: [{ itemId: fx.itemId, quantity: 1 }] },
      { customerId: me.customerId },
    );
    if (!dineIn.ok) throw new Error("dine-in order failed");
    expect(await verifyCustomerToken(tenantId, me.token)).toMatchObject({
      name: "Bilal",
      phone: "0170 999",
      lastDeliveryAddress: { zip: "60311" },
    });

    // A takeaway order refreshes name + phone but leaves the address.
    const takeaway = await placeOrder(
      fx,
      {
        orderType: "takeaway",
        items: [{ itemId: fx.itemId, quantity: 1 }],
        customerName: "Bilal A.",
        customerPhone: "0170 111",
      },
      { customerId: me.customerId },
    );
    if (!takeaway.ok) throw new Error("takeaway order failed");
    expect(await verifyCustomerToken(tenantId, me.token)).toMatchObject({
      name: "Bilal A.",
      phone: "0170 111",
      lastDeliveryAddress: { street: "Weg 1" },
    });

    // An anonymous order touches no profile at all.
    await placeOrder(fx, {
      orderType: "takeaway",
      items: [{ itemId: fx.itemId, quantity: 1 }],
      customerName: "Walk-in",
      customerPhone: "0000",
    });
    expect((await verifyCustomerToken(tenantId, me.token))?.name).toBe("Bilal A.");
  });
});

describe("google ID tokens (native one-tap sign-in)", () => {
  const AUD = "111-web.apps.googleusercontent.com";
  let keys: { privateKey: CryptoKey; verify: JWTVerifyGetKey };

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    keys = { privateKey: pair.privateKey, verify: async () => pair.publicKey };
  });

  afterEach(() => setGoogleIdTokenConfigForTests(null));

  function configure(audiences: string[] = [AUD]): void {
    setGoogleIdTokenConfigForTests({ audiences, keys: keys.verify });
  }

  async function idToken(claims: Record<string, unknown>, aud = AUD): Promise<string> {
    return new SignJWT({ email_verified: true, ...claims })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://accounts.google.com")
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.privateKey);
  }

  it("accepts a well-formed token and returns the OIDC identity", async () => {
    configure();
    const token = await idToken({ sub: "goog-1", email: "g@ex.com", name: "Gita" });
    expect(await verifyGoogleIdToken(token)).toEqual({
      sub: "goog-1",
      email: "g@ex.com",
      name: "Gita",
    });
  });

  it("accepts any of the configured client ids (web, iOS, Android)", async () => {
    configure([AUD, "222-ios.apps.googleusercontent.com"]);
    const token = await idToken(
      { sub: "goog-2", email: "i@ex.com" },
      "222-ios.apps.googleusercontent.com",
    );
    expect(await verifyGoogleIdToken(token)).toMatchObject({ sub: "goog-2" });
  });

  it("rejects another app's audience, an unverified address and an expired token", async () => {
    configure();
    expect(
      await verifyGoogleIdToken(
        await idToken(
          { sub: "goog-3", email: "x@ex.com" },
          "someone-else.apps.googleusercontent.com",
        ),
      ),
    ).toBeNull();

    expect(
      await verifyGoogleIdToken(
        await idToken({ sub: "goog-4", email: "x@ex.com", email_verified: false }),
      ),
    ).toBeNull();

    const expired = await new SignJWT({ sub: "goog-5", email: "x@ex.com", email_verified: true })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://accounts.google.com")
      .setAudience(AUD)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(keys.privateKey);
    expect(await verifyGoogleIdToken(expired)).toBeNull();

    expect(await verifyGoogleIdToken("not.a.jwt")).toBeNull();
  });

  it("rejects a token signed by someone other than Google", async () => {
    configure();
    const other = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({ sub: "goog-6", email: "x@ex.com", email_verified: true })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://accounts.google.com")
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(other.privateKey);
    expect(await verifyGoogleIdToken(forged)).toBeNull();
  });

  it("verifies nothing when no client id is configured", async () => {
    // vitest.setup strips GOOGLE_CLIENT_ID, so this is the real default.
    expect(googleIdTokenAudiences()).toEqual([]);
    configure();
    const token = await idToken({ sub: "goog-7", email: "x@ex.com" });
    setGoogleIdTokenConfigForTests(null);
    expect(await verifyGoogleIdToken(token)).toBeNull();
  });
});
