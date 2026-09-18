import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderTrackerCard, type TrackerOrder } from "./tracker-card";
import { POST_ORDER_COPY } from "@/lib/i18n/post-order";

/**
 * The tracker used to render German with a smaller English line stacked
 * under every step. These assertions pin the replacement: ONE language per
 * render, chosen by the caller, with the date/money formats and `dir`
 * following it.
 */
const order: TrackerOrder = {
  orderNumber: 7,
  status: "preparing",
  orderType: "takeaway",
  paymentStatus: "none",
  totalCents: 2380,
  currency: "EUR",
  createdAt: new Date("2026-09-18T18:00:00Z"),
  tableNumber: null,
  timezone: "Europe/Berlin",
  items: [{ name: "Butter Chicken", priceCents: 1190, quantity: 2 }],
};

const render = (o: TrackerOrder, locale: "en" | "de" | "es" | "it" | "ar"): string =>
  renderToStaticMarkup(OrderTrackerCard({ order: o, locale, themeStyle: {} }));

describe("order tracker", () => {
  it("renders Spanish only — no German or English leaking through", () => {
    const html = render(order, "es");
    expect(html).toContain("Seguimiento del pedido");
    expect(html).toContain("Pedido n.º 0007");
    expect(html).toContain("En preparación");
    expect(html).toContain("Listo para recoger");
    expect(html).toContain("Pago en el restaurante");
    expect(html).toContain("Volver a la carta");
    for (const stray of ["Zubereitung", "Preparing", "Bestellung", "Track your order"]) {
      expect(html, `${stray} leaked into the Spanish render`).not.toContain(stray);
    }
  });

  it("renders Italian only", () => {
    const html = render(order, "it");
    expect(html).toContain("Segui il tuo ordine");
    expect(html).toContain("Ordine n. 0007");
    expect(html).toContain("In preparazione");
    expect(html).toContain("Pronto per il ritiro");
    expect(html).not.toContain("Zubereitung");
    expect(html).not.toContain("Preparing");
  });

  it("renders Arabic right-to-left", () => {
    const html = render({ ...order, orderType: "delivery", status: "out_for_delivery" }, "ar");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(POST_ORDER_COPY.ar.steps.onTheWay);
    expect(html).toContain(POST_ORDER_COPY.ar.steps.delivered);
    expect(html).toContain(POST_ORDER_COPY.ar.trackTitle);
    // Logical utilities only — a physical `left-` would strand the step
    // rail on the wrong side of an RTL render.
    expect(html).toContain("start-[15px]");
    expect(html).not.toMatch(/class="[^"]*\bleft-\[/);
  });

  it("formats money and time in the rendered language, and mirrors nothing in LTR", () => {
    const de = render({ ...order, tableNumber: "4", orderType: "dine_in" }, "de");
    expect(de).toContain('dir="ltr"');
    expect(de).toContain("Tisch 4");
    expect(de).toMatch(/23,80/); // German decimal comma
    const en = render(order, "en");
    expect(en).toMatch(/€23\.80/);
  });

  it("stops the 15-second meta refresh once the order is done", () => {
    expect(render(order, "en")).toContain('content="15"');
    const done = render({ ...order, status: "done" }, "en");
    expect(done).not.toContain('content="15"');
    expect(done).toContain(POST_ORDER_COPY.en.steps.pickedUp);
  });
});
