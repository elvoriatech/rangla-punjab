import { describe, expect, it } from "vitest";
import { paymentWaitMessage, stripeCheckoutLocale } from "./payment-wait-copy";

describe("payment wait copy (Stripe page)", () => {
  it("speaks the guest's language and falls back to German", () => {
    expect(paymentWaitMessage("en")).toMatch(/don't close this window/);
    expect(paymentWaitMessage("de")).toMatch(/nicht/);
    expect(paymentWaitMessage(null)).toBe(paymentWaitMessage("de"));
    expect(paymentWaitMessage("xx")).toBe(paymentWaitMessage("de"));
  });

  it("hands Stripe only locales it has, auto otherwise", () => {
    expect(stripeCheckoutLocale("fr")).toBe("fr");
    expect(stripeCheckoutLocale("ar")).toBe("auto");
    expect(stripeCheckoutLocale(undefined)).toBe("auto");
  });

  it("stays inside Stripe's 1200-character custom text limit", () => {
    for (const l of ["de", "en", "fr", "it", "es", "ar"]) {
      expect(paymentWaitMessage(l).length).toBeLessThan(1200);
    }
  });
});
