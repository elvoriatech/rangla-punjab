import { afterEach, describe, expect, it, vi } from "vitest";
import { isLiveStripeKey, payPalEnvUsableHere, stripeKeyUsableHere } from "./live-key-guard";
import { stripeProviderForKey } from "./stripe";
import { payPalProviderFor } from "./paypal";

describe("live payment keys are refused outside production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("recognises live Stripe keys", () => {
    expect(isLiveStripeKey("sk_live_abc")).toBe(true);
    expect(isLiveStripeKey("rk_live_abc")).toBe(true);
    expect(isLiveStripeKey("sk_test_abc")).toBe(false);
    expect(isLiveStripeKey(null)).toBe(false);
  });

  it("outside production: live refused, test allowed", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(stripeKeyUsableHere("sk_live_abc")).toBe(false);
    expect(stripeKeyUsableHere("sk_test_abc")).toBe(true);
    expect(payPalEnvUsableHere("live")).toBe(false);
    expect(payPalEnvUsableHere("sandbox")).toBe(true);
  });

  it("in production: live keys work", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(stripeKeyUsableHere("sk_live_abc")).toBe(true);
    expect(payPalEnvUsableHere("live")).toBe(true);
  });

  it("a live key saved locally falls back to the fake providers", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await stripeProviderForKey("sk_live_not_real", "whsec_x")).mode).toBe("fake");
    const pp = payPalProviderFor({ clientId: "id", secret: "s", env: "live", enabled: true });
    expect(pp.mode).toBe("fake");
  });
});
