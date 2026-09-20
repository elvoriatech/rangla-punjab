import { describe, expect, it } from "vitest";
import {
  renderTicketHtml,
  ticketAddressLine,
  ticketDirectionsUrl,
  type TicketOrder,
} from "./ticket-html";

/**
 * The ticket the counter tablet prints.
 *
 * The load-bearing assertion is SELF-CONTAINMENT: `expo-print` hands this
 * string to the OS print pipeline in a WebView with no stylesheet of ours
 * and no reliable network, so a single `<link>`, `<img src>` or Tailwind
 * class name is a ticket that prints as unstyled text — or blank.
 */
function order(over: Partial<TicketOrder> = {}): TicketOrder {
  return {
    orderNumber: 42,
    orderType: "dine_in",
    tableNumber: "7",
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
    totalCents: 2400,
    currency: "EUR",
    createdAt: new Date("2026-09-19T17:30:00Z"),
    items: [{ name: "Dal Makhani", quantity: 2, priceCents: 1200 }],
    ...over,
  };
}

const VENUE = { name: "Rangla Punjab" };

describe("renderTicketHtml", () => {
  it("is one self-contained document — no stylesheet, no asset, no Tailwind", () => {
    const html = renderTicketHtml(order(), VENUE);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    // Tailwind's utility soup would be `class="mt-2 font-bold …"`; the
    // ticket's own hooks are single semantic names in the inline sheet.
    expect(/class="[^"]*\b(mt-\d|text-\[|font-mono|flex\b.*\bjustify-between)/.test(html)).toBe(
      false,
    );
  });

  it("is sized for an 80 mm roll and asks the renderer for no margin", () => {
    const html = renderTicketHtml(order(), VENUE);
    expect(html).toContain("@page { margin: 0;");
    expect(html).toContain("width: 302px");
    expect(html).toContain("@media print");
    expect(html).toContain("font-size: 13px");
    expect(html).toContain("monospace");
  });

  it("centres the 302 px column on wider paper and cuts to the roll when it can", () => {
    const html = renderTicketHtml(order(), VENUE);
    // Auto side margins: the phone's print preview and any A4/letter sheet
    // put the ticket in the middle rather than against the left edge.
    // Horizontal only, so the ticket still starts at the top of the page.
    expect(html).toContain("margin: 0 auto");
    // …and it survives into the print sheet, not just the on-screen preview.
    const print = html.slice(html.indexOf("@media print"));
    expect(print).toContain("margin: 0 auto");
    // A receipt printer that honours `size` trims the page to the roll.
    expect(print).toContain("@page { size: 80mm auto; margin: 0; }");
    // The column itself must stay 80 mm — centring must not widen it.
    expect(html).not.toContain("width: 100%");
  });

  it("carries the venue, the padded order number, the time and the dishes", () => {
    const html = renderTicketHtml(order(), VENUE);
    expect(html).toContain("Rangla Punjab");
    expect(html).toContain("Kitchen ticket");
    expect(html).toContain("#0042");
    expect(html).toContain("Dal Makhani");
    expect(html).toContain("2x");
    // Line total, not unit price: 2 × €12.00.
    expect(html).toContain("24,00");
    expect(html).toContain("TOTAL");
    expect(html).toContain("IM RESTAURANT — TISCH 7");
  });

  it("prints a per-line note under its dish", () => {
    const html = renderTicketHtml(
      order({
        items: [{ name: "Dal Makhani", quantity: 1, priceCents: 1200, note: "ohne Sahne" }],
      }),
      VENUE,
    );
    expect(html).toContain("ohne Sahne");
    expect(html).toContain('class="note"');
  });

  it("escapes a dish name that looks like markup", () => {
    const html = renderTicketHtml(
      order({ items: [{ name: '<script>alert("x")</script>', quantity: 1, priceCents: 100 }] }),
      VENUE,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("warns loudly when an online payment has not settled", () => {
    const pending = renderTicketHtml(order({ paymentStatus: "pending" }), VENUE);
    expect(pending).toContain("** ONLINE PAYMENT PENDING **");
    expect(pending).toContain("do not hand out");

    const card = renderTicketHtml(
      order({ paymentStatus: "paid", paymentProvider: "stripe" }),
      VENUE,
    );
    expect(card).toContain("** PAID ONLINE (CARD) **");
    expect(card).toContain("nothing to collect");

    const paypal = renderTicketHtml(
      order({ paymentStatus: "paid", paymentProvider: "paypal" }),
      VENUE,
    );
    expect(paypal).toContain("** PAID ONLINE (PAYPAL) **");

    const voucher = renderTicketHtml(
      order({ paymentStatus: "paid", paymentProvider: "voucher" }),
      VENUE,
    );
    expect(voucher).toContain("PAID WITH REWARD");

    const cash = renderTicketHtml(order(), VENUE);
    expect(cash).toContain("Payment at the restaurant.");
    expect(cash).not.toContain("**");
  });

  it("shows the reward line so the ticket's arithmetic matches the till", () => {
    const html = renderTicketHtml(
      order({ discountCents: 500, discountPoints: 100, totalCents: 1900 }),
      VENUE,
    );
    expect(html).toContain("GUTSCHEIN / REWARD");
    expect(html).toContain("-5,00");
    expect(html).toContain("19,00");
  });

  it("shows the gift-card line under the reward, with the masked code", () => {
    const html = renderTicketHtml(
      order({
        discountCents: 500,
        discountPoints: 100,
        giftCardDiscountCents: 400,
        giftCardLast4: "EFGH",
        totalCents: 1500,
      }),
      VENUE,
    );
    expect(html).toContain("GESCHENKGUTSCHEIN / GIFT CARD &middot;&middot;&middot;&middot;EFGH");
    expect(html).toContain("-4,00");
    // The reward row is still above it — one order, two instruments.
    expect(html).toContain("GUTSCHEIN / REWARD");
    expect(html).toContain("15,00");
  });

  it("a gift card that covered the bill tells the counter to collect nothing", () => {
    const html = renderTicketHtml(
      order({
        giftCardDiscountCents: 2400,
        giftCardLast4: "EFGH",
        totalCents: 0,
        paymentStatus: "paid",
        paymentProvider: "gift_card",
      }),
      VENUE,
    );
    expect(html).toContain("PAID WITH GIFT CARD");
    expect(html).toContain("paid with a gift card — nothing to collect.");
    expect(html).not.toContain("Paid online via");
  });

  it("prints the delivery details, the planned time and the directions QR", () => {
    const html = renderTicketHtml(
      order({
        orderType: "delivery",
        tableNumber: null,
        customerName: "Amrit Kaur",
        customerPhone: "+49 231 1234567",
        requestedFor: new Date("2026-09-19T18:15:00Z"),
        deliveryAddress: {
          street: "Bornstraße 12",
          zip: "44145",
          city: "Dortmund",
          note: "2. OG, klingeln",
        },
      }),
      VENUE,
      { navQrSvg: '<svg viewBox="0 0 25 25"><rect width="25" height="25"/></svg>' },
    );
    expect(html).toContain("LIEFERUNG / DELIVERY");
    expect(html).toContain("Amrit Kaur");
    expect(html).toContain("+49 231 1234567");
    expect(html).toContain("Bornstraße 12, 44145 Dortmund");
    expect(html).toContain("2. OG, klingeln");
    expect(html).toContain("Geplant für");
    // The caption names BOTH things the scan now does — it dispatches the
    // order as well as opening the route (see `dispatch-service.ts`). A
    // driver who believes it is only navigation stops using it the day
    // their phone remembers the address, and the guest stops being told.
    expect(html).toContain("Scan: unterwegs + Route / out for delivery + route");
    expect(html).toContain('<svg viewBox="0 0 25 25">');
  });

  it("leaves the QR block out entirely when there is nothing to navigate to", () => {
    const html = renderTicketHtml(order({ orderType: "takeaway", tableNumber: null }), VENUE);
    expect(html).toContain("ABHOLUNG / PICKUP");
    expect(html).not.toContain("out for delivery + route");
  });

  it("formats money and times in the requested locale", () => {
    const en = renderTicketHtml(order(), VENUE, { locale: "en" });
    expect(en).toContain("€24.00");
    expect(en).toContain('<html lang="en">');
  });
});

describe("ticketAddressLine / ticketDirectionsUrl", () => {
  it("builds a one-line address only for a delivery that has a street", () => {
    expect(
      ticketAddressLine({
        orderType: "delivery",
        deliveryAddress: { street: "Bornstraße 12", zip: "44145", city: "Dortmund" },
      }),
    ).toBe("Bornstraße 12, 44145 Dortmund");
    expect(
      ticketAddressLine({ orderType: "takeaway", deliveryAddress: { street: "X" } }),
    ).toBeNull();
    expect(ticketAddressLine({ orderType: "delivery", deliveryAddress: null })).toBeNull();
    expect(
      ticketAddressLine({ orderType: "delivery", deliveryAddress: { zip: "44145" } }),
    ).toBeNull();
  });

  it("encodes the address into a universal Maps directions link", () => {
    const url = ticketDirectionsUrl("Bornstraße 12, 44145 Dortmund");
    expect(url.startsWith("https://www.google.com/maps/dir/?api=1&destination=")).toBe(true);
    expect(url).toContain("travelmode=driving");
    expect(url).not.toContain(" ");
  });
});
