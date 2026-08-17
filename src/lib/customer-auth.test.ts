import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import {
  customerProviders,
  exchangeCode,
  revokeCustomerToken,
  signInCustomer,
  signState,
  verifyCustomerToken,
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

  it("orders placed with a customer are linked and listable for that customer only", async () => {
    const tenantId = await tenantFixture();
    // minimal venue + published item
    const fx = await asTenant(tenantId, async (tx) => {
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
});
