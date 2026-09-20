import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderTrackerCard, type TrackerOrder } from "./tracker-card";
import { POST_ORDER_COPY } from "@/lib/i18n/post-order";
import { UI_LOCALES, type UiLocale } from "@/lib/locales";

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

const render = (
  o: TrackerOrder,
  locale: UiLocale,
  pauseRefresh = false,
  reviewUrl: string | null = null,
  reviewPrompted = false,
): string =>
  renderToStaticMarkup(
    OrderTrackerCard({ order: o, locale, themeStyle: {}, pauseRefresh, reviewUrl, reviewPrompted }),
  );

/** Our tracked redirect, which is what the page hands the card now — the
 *  hop that records the tap before forwarding to Google. */
const REVIEW = "https://menu.example/api/v1/orders/ord_1/review?token=tok_1";

/** React escapes apostrophes in text nodes ("Com'è" → "Com&#x27;è"), so
 *  copy with one has to be escaped the same way before being looked for. */
const esc = (s: string): string => s.replaceAll("'", "&#x27;");

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

  it("replaces the step rail with a cancelled banner, in the guest's language", () => {
    for (const locale of UI_LOCALES) {
      const html = render({ ...order, status: "cancelled" }, locale);
      expect(html).toContain(esc(POST_ORDER_COPY[locale].cancelledTitle));
      expect(html).toContain(esc(POST_ORDER_COPY[locale].cancelledBody));
      // No rail: a half-lit chain would read as "still on its way".
      expect(html).not.toContain(esc(POST_ORDER_COPY[locale].steps.preparing));
      expect(html).not.toContain("start-[15px]");
      // And nothing left to poll for.
      expect(html).not.toContain('content="15"');
      expect(html).not.toContain(esc(POST_ORDER_COPY[locale].autoRefresh));
      // Still the same receipt underneath — the guest keeps the lines,
      // the total and the way back to the menu.
      expect(html).toContain("Butter Chicken");
      expect(html).toContain(esc(POST_ORDER_COPY[locale].backToMenu));
    }
  });

  it("asks for a Google review once the order is done, in the guest's language", () => {
    for (const locale of UI_LOCALES) {
      const html = render({ ...order, status: "done" }, locale, false, REVIEW);
      const t = POST_ORDER_COPY[locale].review;
      expect(html).toContain(esc(t.title));
      expect(html).toContain(esc(t.cta));
      expect(html).toContain(`href="${REVIEW}"`);
      // It leaves the page, so it says so — in markup and to a reader.
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain(esc(t.newTab));
    }
  });

  it("keeps the ask off every order that has nothing to rate yet", () => {
    // Still cooking: asking now is asking about a promise.
    expect(render(order, "en", false, REVIEW)).not.toContain(POST_ORDER_COPY.en.review.cta);
    // Cancelled: there was no meal.
    expect(render({ ...order, status: "cancelled" }, "en", false, REVIEW)).not.toContain(
      POST_ORDER_COPY.en.review.cta,
    );
    // Done, but the venue has no Place ID (or the owner switched the
    // rating off) — no link, so no button at all.
    const noLink = render({ ...order, status: "done" }, "en");
    expect(noLink).not.toContain(POST_ORDER_COPY.en.review.cta);
    expect(noLink).not.toContain(POST_ORDER_COPY.en.review.title);
  });

  it("retires the ask once the guest has already followed it", () => {
    // Google tells us nothing about whether a review was written, so the
    // tap is all we know — and it is enough to stop asking. Nothing of
    // the block survives: no heading, no button, no link.
    const asked = render({ ...order, status: "done" }, "en", false, REVIEW, true);
    expect(asked).not.toContain(POST_ORDER_COPY.en.review.cta);
    expect(asked).not.toContain(POST_ORDER_COPY.en.review.title);
    expect(asked).not.toContain(REVIEW);
    // Everything else about a finished order is untouched.
    expect(asked).toContain("Butter Chicken");
    expect(asked).toContain(POST_ORDER_COPY.en.backToMenu);
  });

  it("drops the refresh — and the promise of one — while a complaint is being written", () => {
    const paused = render(order, "en", true);
    expect(paused).not.toContain('content="15"');
    // The page must not claim it refreshes itself when it doesn't.
    expect(paused).not.toContain(POST_ORDER_COPY.en.autoRefresh);
    // Still the same tracker otherwise.
    expect(paused).toContain(POST_ORDER_COPY.en.steps.preparing);
  });
});
