import { describe, expect, it } from "vitest";
import { isDrinkCategory } from "./drink-items";
import { renderTicketEscPos } from "./ticket-escpos";
import { renderTicketHtml, type TicketOrder } from "./ticket-html";

describe("isDrinkCategory", () => {
  it("knows this menu's drinks sections", () => {
    for (const name of [
      "Getränke",
      "Kalte Getränke",
      "Alkoholische Getränke",
      "Bier",
      "Bier alkoholfrei",
      "Weißwein",
      "Rotwein",
      "Rosé",
      "Lassi",
      "Hausgemachte Lassi",
      "Limonade",
      "Alkoholfreie Cocktails",
      "Kaffee und Tee",
      "Aperitif",
    ])
      expect(isDrinkCategory(name), name).toBe(true);
  });
  it("leaves the food alone", () => {
    for (const name of [
      "Currys",
      "Vorspeisen",
      "Tandoori Spezialitäten",
      "Hähnchen Gerichte",
      "Desserts",
      "Tagessuppen",
      "Reis & Brot",
      "Thali",
    ])
      expect(isDrinkCategory(name), name).toBe(false);
  });
});

function order(): TicketOrder {
  return {
    orderNumber: 3,
    orderType: "pickup",
    tableNumber: null,
    customerName: null,
    customerPhone: null,
    requestedFor: null,
    deliveryAddress: null,
    paymentStatus: "none",
    paymentProvider: null,
    discountCents: 0,
    discountPoints: 0,
    giftCardDiscountCents: 0,
    giftCardLast4: null,
    totalCents: 1690,
    currency: "EUR",
    createdAt: new Date("2026-10-11T17:30:00Z"),
    items: [
      { name: "Butter Chicken", quantity: 1, priceCents: 1290 },
      { name: "Mango Lassi", quantity: 1, priceCents: 400, isDrink: true },
    ],
  };
}

describe("drinks on the order receipt", () => {
  it("boxes only the drink lines, and not on the kitchen copy", () => {
    const html = renderTicketHtml(order(), { name: "Rangla Punjab" });
    expect(html.match(/<li class="drink">/g)).toHaveLength(1);
    expect(html).toMatch(
      /<li class="drink"><span class="qty">1x<\/span> <span class="nm">Mango Lassi/,
    );
  });
  it("draws the box in ESC/POS too", () => {
    const text = Buffer.from(
      renderTicketEscPos(order(), { name: "Rangla Punjab" }, { paper: 58 }),
    ).toString("latin1");
    expect(text).toContain(`+${"-".repeat(30)}+`);
    expect(text).toMatch(/\| 1x Mango Lassi\s+4,00 EUR \|/);
    expect(text).not.toMatch(/\| 1x Butter Chicken/);
  });
});
