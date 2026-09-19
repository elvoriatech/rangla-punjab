import { describe, expect, it } from "vitest";
import {
  deliveryQuote,
  effectiveOrdering,
  orderingConfigSchema,
  parseOrderingConfig,
  type EffectiveOrdering,
} from "./ordering-config";

const ALL_ON = {
  dineIn: true,
  takeaway: true,
  delivery: true,
  kitchen: true,
  stats: true,
  payments: true,
};

function modeWith(config: unknown): EffectiveOrdering {
  return effectiveOrdering(ALL_ON, parseOrderingConfig(config));
}

describe("delivery areas config", () => {
  it("parses per-ZIP rows and defaults missing/null numbers to 0", () => {
    const config = parseOrderingConfig({
      deliveryAreas: [
        { zip: "78467", locality: "Konstanz", feeCents: 100, minCents: 2500, freeOverCents: 5000 },
        // Half-filled row: nulls and missing fields must not break the
        // parse — they fall to 0.
        { zip: "78462", feeCents: null, minCents: undefined },
        // Garbage numbers also fall to 0 instead of failing.
        { zip: "78464", feeCents: "abc", minCents: -5, freeOverCents: NaN },
      ],
    });
    expect(config.deliveryAreas).toHaveLength(3);
    expect(config.deliveryAreas[0]).toMatchObject({ feeCents: 100, minCents: 2500 });
    expect(config.deliveryAreas[1]).toMatchObject({
      locality: "",
      feeCents: 0,
      minCents: 0,
      freeOverCents: 0,
    });
    expect(config.deliveryAreas[2]).toMatchObject({ feeCents: 0, minCents: 0, freeOverCents: 0 });
  });

  it("converts a legacy zips+flat-fee config into per-ZIP rows", () => {
    const config = parseOrderingConfig({
      deliveryZips: ["60311", "60313"],
      deliveryFeeCents: 250,
      deliveryMinCents: 1000,
    });
    expect(config.deliveryAreas).toEqual([
      { zip: "60311", locality: "", feeCents: 250, minCents: 1000, freeOverCents: 0 },
      { zip: "60313", locality: "", feeCents: 250, minCents: 1000, freeOverCents: 0 },
    ]);
  });

  it("quotes per-area fee and minimum by ZIP, rejecting unknown ZIPs", () => {
    const mode = modeWith({
      deliveryAreas: [
        { zip: "78467", feeCents: 100, minCents: 2500 },
        { zip: "78476", feeCents: 300, minCents: 4000 },
      ],
    });
    expect(deliveryQuote(mode, "78467", 3000)).toEqual({
      feeCents: 100,
      minCents: 2500,
      locality: "",
    });
    expect(deliveryQuote(mode, "78476", 3000)).toEqual({
      feeCents: 300,
      minCents: 4000,
      locality: "",
    });
    expect(deliveryQuote(mode, "99999", 3000)).toBeNull();
  });

  it("zeroes the fee past the area's free-delivery threshold", () => {
    const mode = modeWith({
      deliveryAreas: [{ zip: "78467", feeCents: 200, minCents: 2500, freeOverCents: 5000 }],
    });
    expect(deliveryQuote(mode, "78467", 4999)).toEqual({
      feeCents: 200,
      minCents: 2500,
      locality: "",
    });
    expect(deliveryQuote(mode, "78467", 5000)).toEqual({
      feeCents: 0,
      minCents: 2500,
      locality: "",
    });
  });

  it("falls back to the flat fee for any ZIP when no areas are defined", () => {
    const mode = modeWith({ deliveryFeeCents: 250, deliveryMinCents: 1000 });
    expect(deliveryQuote(mode, "anything", 500)).toEqual({
      feeCents: 250,
      minCents: 1000,
      locality: "",
    });
  });
});

describe("accepted payments", () => {
  it("defaults to the German-typical set when absent", () => {
    expect(parseOrderingConfig({}).acceptedPayments).toEqual([
      "cash",
      "girocard",
      "visa",
      "mastercard",
    ]);
  });

  it('expands legacy "credit" to Visa + Mastercard and drops junk per item', () => {
    const config = parseOrderingConfig({
      acceptedPayments: ["cash", "credit", "bitcoin", 42, "paypal"],
    });
    expect(config.acceptedPayments).toEqual(["cash", "visa", "mastercard", "paypal"]);
  });

  it("keeps an explicitly chosen subset as-is", () => {
    expect(parseOrderingConfig({ acceptedPayments: ["apple_pay"] }).acceptedPayments).toEqual([
      "apple_pay",
    ]);
  });
});

describe("new-order notification emails", () => {
  it("defaults to none", () => {
    expect(parseOrderingConfig({}).notifyEmails).toEqual([]);
  });

  it("splits the settings form's comma/newline string, lowercases and dedupes", () => {
    expect(
      parseOrderingConfig({ notifyEmails: "Chef@Ex.de, kueche@ex.de\nchef@ex.de; " }).notifyEmails,
    ).toEqual(["chef@ex.de", "kueche@ex.de"]);
  });

  it("drops junk per address instead of failing the save", () => {
    expect(
      parseOrderingConfig({ notifyEmails: ["ok@ex.de", "not an email", 42, "@nope"] }).notifyEmails,
    ).toEqual(["ok@ex.de"]);
  });

  it("caps the list at five", () => {
    const many = Array.from({ length: 8 }, (_, i) => `p${i}@ex.de`);
    expect(parseOrderingConfig({ notifyEmails: many }).notifyEmails).toHaveLength(5);
  });
});

describe("complaint window (issueWindowHours)", () => {
  it("defaults to three hours on a venue that never set it", () => {
    expect(parseOrderingConfig({}).issueWindowHours).toBe(3);
    expect(parseOrderingConfig(null).issueWindowHours).toBe(3);
  });

  it("keeps whole hours and has no product ceiling", () => {
    expect(parseOrderingConfig({ issueWindowHours: 1 }).issueWindowHours).toBe(1);
    expect(parseOrderingConfig({ issueWindowHours: 168 }).issueWindowHours).toBe(168);
    // The settings form posts a string; a fraction rounds to whole hours.
    expect(parseOrderingConfig({ issueWindowHours: "24" }).issueWindowHours).toBe(24);
    expect(parseOrderingConfig({ issueWindowHours: 2.6 }).issueWindowHours).toBe(3);
  });

  it("clamps or falls back rather than failing the whole save", () => {
    // A half-filled form must not take delivery areas down with it.
    for (const raw of [undefined, null, "", "abc", NaN]) {
      expect(parseOrderingConfig({ issueWindowHours: raw }).issueWindowHours).toBe(3);
    }
    // Below the floor is "off", which this setting does not express.
    expect(parseOrderingConfig({ issueWindowHours: 0 }).issueWindowHours).toBe(1);
    expect(parseOrderingConfig({ issueWindowHours: -5 }).issueWindowHours).toBe(1);
  });

  it("survives a round trip that only touches the switches", () => {
    const config = parseOrderingConfig({ issueWindowHours: 12, takeaway: false });
    const next = orderingConfigSchema.parse({ ...config, takeaway: true });
    expect(next.issueWindowHours).toBe(12);
  });
});

describe("cancel-from-the-app switch (appCancelEnabled)", () => {
  it("is OFF on a venue that never set it — a cancel button is opt-in", () => {
    expect(parseOrderingConfig({}).appCancelEnabled).toBe(false);
    expect(parseOrderingConfig(null).appCancelEnabled).toBe(false);
    // Every other switch defaults ON; this one is the exception, because
    // cancelling is terminal and a phone in a pocket taps things.
    expect(parseOrderingConfig({}).takeaway).toBe(true);
  });

  it("stores the owner's yes", () => {
    expect(parseOrderingConfig({ appCancelEnabled: true }).appCancelEnabled).toBe(true);
    expect(parseOrderingConfig({ appCancelEnabled: false }).appCancelEnabled).toBe(false);
  });

  it("tolerates a checkbox string or junk rather than failing the save", () => {
    // The settings form posts "on"; a legacy config may hold a string.
    expect(parseOrderingConfig({ appCancelEnabled: "on" }).appCancelEnabled).toBe(true);
    expect(parseOrderingConfig({ appCancelEnabled: "true" }).appCancelEnabled).toBe(true);
    for (const raw of [undefined, null, "", "off", "nonsense", 0, NaN, {}]) {
      expect(parseOrderingConfig({ appCancelEnabled: raw }).appCancelEnabled).toBe(false);
    }
    // Junk here must not take the rest of the config down with it.
    expect(parseOrderingConfig({ appCancelEnabled: "nope", takeaway: false }).takeaway).toBe(false);
  });

  it("survives a round trip that only touches the switches", () => {
    const config = parseOrderingConfig({ appCancelEnabled: true, delivery: false });
    const next = orderingConfigSchema.parse({ ...config, delivery: true });
    expect(next.appCancelEnabled).toBe(true);
  });
});
