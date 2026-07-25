import { describe, expect, it } from "vitest";
import { FakeStripeProvider, getStripeProvider, isStripeConfigured } from ".";
import type { StripeEvent } from "./provider";

const SECRET = "whsec_test_p1_19b";

describe("StripeProvider selector", () => {
  it("returns the fake in this test environment (STRIPE_SECRET_KEY unset)", async () => {
    // Neither STRIPE_SECRET_KEY nor STRIPE_WEBHOOK_SECRET is set in
    // vitest.env, so the selector must land on the fake.
    expect(isStripeConfigured()).toBe(false);
    const provider = await getStripeProvider();
    expect(provider.mode).toBe("fake");
  });
});

describe("FakeStripeProvider — signing round-trip", () => {
  const fake = new FakeStripeProvider(SECRET);

  it("signWebhook + constructWebhookEvent are inverses for a happy payload", () => {
    const event: StripeEvent = {
      id: "evt_test_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", customer: "cus_1" } },
    };
    const { body, header } = fake.signWebhook(event);
    // Header shape matches Stripe's real header (t=<unix>,v1=<hex>).
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const parsed = fake.constructWebhookEvent(body, header);
    expect(parsed.id).toBe("evt_test_1");
    expect(parsed.type).toBe("checkout.session.completed");
  });

  it("rejects a tampered body — the signed HMAC no longer matches", () => {
    const event: StripeEvent = {
      id: "evt_test_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    };
    const { body, header } = fake.signWebhook(event);
    const tampered = body.replace("sub_1", "sub_EVIL");
    expect(() => fake.constructWebhookEvent(tampered, header)).toThrow(/mismatch/);
  });

  it("rejects a tampered signature — different HMAC than expected", () => {
    const event: StripeEvent = {
      id: "evt_test_3",
      type: "checkout.session.completed",
      data: { object: {} },
    };
    const { body } = fake.signWebhook(event);
    const bogusSig = "a".repeat(64);
    expect(() =>
      fake.constructWebhookEvent(body, `t=${Math.floor(Date.now() / 1000)},v1=${bogusSig}`),
    ).toThrow(/mismatch/);
  });

  it("rejects a malformed Stripe-Signature header shape", () => {
    const event: StripeEvent = { id: "evt_test_4", type: "any", data: { object: {} } };
    const { body } = fake.signWebhook(event);
    for (const bad of ["", "not-a-header", "t=only", "v1=only"]) {
      expect(() => fake.constructWebhookEvent(body, bad)).toThrow();
    }
  });

  it("rejects a signature computed with a different secret (domain separation)", () => {
    const good = new FakeStripeProvider(SECRET);
    const evil = new FakeStripeProvider("whsec_different_secret");
    const event: StripeEvent = { id: "evt_test_5", type: "any", data: { object: {} } };
    const { body, header } = evil.signWebhook(event);
    expect(() => good.constructWebhookEvent(body, header)).toThrow(/mismatch/);
  });
});

describe("FakeStripeProvider — CRUD stubs return usable references", () => {
  const fake = new FakeStripeProvider(SECRET);

  it("createCustomer returns a cus_-prefixed id", async () => {
    const c = await fake.createCustomer({ email: "chef@example.com", tenantId: "t1" });
    expect(c.id).toMatch(/^cus_fake_/);
  });

  it("createCheckoutSession returns a cs_-prefixed id + URL", async () => {
    const s = await fake.createCheckoutSession({
      customerId: "cus_fake_1",
      priceId: "price_test",
      successUrl: "https://elvoria.eu/ok",
      cancelUrl: "https://elvoria.eu/cancel",
      trialDays: 14,
      tenantId: "t1",
      planCode: "support",
    });
    expect(s.id).toMatch(/^cs_fake_/);
    expect(s.url).toMatch(/^https:\/\/fake-stripe\.local\/checkout\//);
  });

  it("createBillingPortalSession returns a portal URL with the return path encoded", async () => {
    const s = await fake.createBillingPortalSession({
      customerId: "cus_fake_2",
      returnUrl: "https://elvoria.eu/dashboard/billing",
    });
    expect(s.url).toContain("cus_fake_2");
    expect(s.url).toContain(encodeURIComponent("https://elvoria.eu/dashboard/billing"));
  });

  it("retrieveSubscription returns null for unseeded ids and the seeded value otherwise", async () => {
    expect(await fake.retrieveSubscription("sub_missing")).toBeNull();
    fake.seedSubscription({
      id: "sub_1",
      customerId: "cus_1",
      status: "trialing",
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAt: null,
      planPriceId: "price_starter",
    });
    const s = await fake.retrieveSubscription("sub_1");
    expect(s?.status).toBe("trialing");
    expect(s?.planPriceId).toBe("price_starter");
  });
});
