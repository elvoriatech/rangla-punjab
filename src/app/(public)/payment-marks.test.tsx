import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { acceptedPaymentIds, PaymentMarks } from "./payment-marks";

describe("acceptedPaymentIds", () => {
  it("keeps what the owner ticked when no online rail is live", () => {
    expect(acceptedPaymentIds({ accepted: ["cash", "girocard"] })).toEqual(["cash", "girocard"]);
  });

  it("implies the Stripe card brands once card payment is enabled", () => {
    expect(acceptedPaymentIds({ accepted: ["cash"], onlinePayment: true })).toEqual([
      "cash",
      "visa",
      "mastercard",
      "amex",
    ]);
  });

  it("adds PayPal only on its own rail, without duplicating a ticked brand", () => {
    expect(
      acceptedPaymentIds({
        accepted: ["visa", "paypal"],
        onlinePayment: true,
        paypalPayment: true,
      }),
    ).toEqual(["visa", "mastercard", "amex", "paypal"]);
  });

  it("returns nothing when there is nothing to show", () => {
    expect(acceptedPaymentIds({})).toEqual([]);
  });

  it("orders marks by the registry, not by the caller's array", () => {
    expect(acceptedPaymentIds({ accepted: ["paypal", "cash", "visa"] })).toEqual([
      "cash",
      "visa",
      "paypal",
    ]);
  });
});

describe("<PaymentMarks>", () => {
  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<PaymentMarks ids={[]} />)).toBe("");
  });

  it("renders official artwork with an accessible name per brand", () => {
    const html = renderToStaticMarkup(<PaymentMarks ids={["visa", "mastercard", "amex"]} />);
    expect(html).toContain("/brand/pay/visa.svg");
    expect(html).toContain("/brand/pay/mastercard.svg");
    expect(html).toContain('aria-label="American Express"');
    // Artwork is decorative inside a labelled chip — never doubly announced.
    expect(html).toContain('alt=""');
  });

  it("falls back to the registry emoji for methods without a brand mark", () => {
    const html = renderToStaticMarkup(<PaymentMarks ids={["cash"]} />);
    expect(html).toContain("💶");
    expect(html).toContain('aria-label="Cash"');
  });
});
