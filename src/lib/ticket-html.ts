import { formatPrice } from "./public-menu";
import type { KitchenOrder } from "./order-service";

/**
 * The 80 mm kitchen ticket as ONE self-contained HTML document.
 *
 * ## Why a string and not a React component
 *
 * The counter iPad prints through `expo-print`'s `printAsync({ html })`,
 * which hands the markup to the OS print pipeline (AirPrint on iOS,
 * the Android print framework) in a WebView that has no network identity
 * and no stylesheet of ours. So the ticket has to arrive complete:
 * inline `<style>`, no Tailwind, no font file, no image URL. Anything
 * fetched is a race between the print dialog and the network, and the
 * thing that loses prints blank.
 *
 * `/print/order/{id}` stays a React page for the dashboard's own Print
 * button — that one runs in a browser that already has the app's CSS.
 * The two share their SHAPING (`ticketAddressLine`, `ticketDirectionsUrl`)
 * rather than their markup, because the constraints genuinely differ.
 *
 * ## Print-hostile things deliberately avoided
 *
 * - No colour emoji: thermal drivers rasterise SVG happily and choke on
 *   emoji fonts, so the info rows use the same 24×24 vector glyphs the
 *   print page does.
 * - No `position`, no flex gaps wider than the roll: at 302 px a stray
 *   horizontal overflow silently clips the price column.
 * - `@page { margin: 0 }` because a receipt printer's own margin is the
 *   roll edge; anything the renderer adds is wasted paper per ticket.
 *   `@media print` narrows that to `size: 80mm auto`, so a printer that
 *   honours page size cuts to the roll instead of centring 80 mm of ticket
 *   on an A4 sheet — and where it is ignored, the column's auto side
 *   margins still put it in the middle of whatever paper turns up.
 */

/** Material icon paths (24×24) for the ticket's info rows. */
const GLYPHS = {
  phone:
    "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  person:
    "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  clock:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  table:
    "M21.96 9.73l-1.43-5C20.41 4.3 20.02 4 19.6 4H4.4c-.42 0-.81.3-.93.73l-1.43 5c-.18.63.3 1.27.96 1.27h2.2L4 20h2l.67-5h10.67l.66 5h2l-1.2-9H21c.66 0 1.14-.64.96-1.27zM6.93 13l.27-2h9.6l.27 2H6.93z",
  note: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z",
} as const;

type Glyph = keyof typeof GLYPHS;

/** The ticket's view of an order. `KitchenOrder` satisfies it; the extra
 *  optional per-line `note` is accepted so a kitchen note added later
 *  prints without another renderer. */
export interface TicketOrder {
  orderNumber: number;
  orderType: string;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  requestedFor: Date | null;
  deliveryAddress: { street?: string; zip?: string; city?: string; note?: string } | null;
  paymentStatus: string;
  paymentProvider: string | null;
  discountCents: number;
  /** Points the reward cost. 0 = no reward, or an order from before the
   *  column existed — the row then omits the points. */
  discountPoints: number;
  totalCents: number;
  currency: string;
  createdAt: Date;
  items: { name: string; quantity: number; priceCents: number; note?: string | null }[];
}

/* A compile-time nudge: if `KitchenOrder` ever stops fitting the ticket,
   fail here rather than at a counter with a printer waiting. */
const _kitchenOrderFits: (o: KitchenOrder) => TicketOrder = (o) => o;
void _kitchenOrderFits;

export interface TicketVenue {
  name: string;
  /** Wall-clock the kitchen reads; defaults to the deploy's own. */
  timezone?: string | null;
}

export interface TicketOptions {
  /** Formatting locale for times and money. The ticket's fixed words stay
   *  bilingual DE/EN — the counter reads one, a tourist courier the other. */
  locale?: string;
}

const DEFAULT_TZ = "Europe/Berlin";
const DEFAULT_LOCALE = "de";
const RULE = "--------------------------------------";

/** Escape for HTML text and attribute values alike. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Bornstraße 12, 44145 Dortmund" for a delivery with a street, else
 *  null. Shared with the print page's QR so the address the driver
 *  navigates to is the address printed above it. */
export function ticketAddressLine(order: {
  orderType: string;
  deliveryAddress: { street?: string; zip?: string; city?: string } | null;
}): string | null {
  const a = order.deliveryAddress;
  if (order.orderType !== "delivery" || !a?.street) return null;
  return [a.street, [a.zip, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** Universal Maps directions link: opens turn-by-turn navigation from any
 *  phone camera — no app account, nothing typed. */
export function ticketDirectionsUrl(addressLine: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine)}&travelmode=driving`;
}

function typeBanner(order: TicketOrder): string {
  if (order.orderType === "delivery") return "LIEFERUNG / DELIVERY";
  if (order.orderType === "takeaway") return "ABHOLUNG / PICKUP";
  return `IM RESTAURANT${order.tableNumber ? ` — TISCH ${order.tableNumber}` : ""}`;
}

/** The bold line under the header: what the kitchen must know about money
 *  before it hands anything over. */
function paymentBanner(order: TicketOrder): string | null {
  if (order.paymentStatus === "paid") {
    if (order.paymentProvider === "voucher") {
      return "** MIT GUTSCHEIN BEZAHLT / PAID WITH REWARD **";
    }
    return `** PAID ONLINE${order.paymentProvider === "paypal" ? " (PAYPAL)" : " (CARD)"} **`;
  }
  if (order.paymentStatus === "pending") return "** ONLINE PAYMENT PENDING **";
  return null;
}

function paymentFooter(order: TicketOrder): string {
  if (order.paymentStatus === "paid") {
    return order.paymentProvider === "voucher"
      ? "Mit Treuegutschein bezahlt / paid with a loyalty reward — nothing to collect."
      : `Paid online via ${order.paymentProvider === "paypal" ? "PayPal" : "card"} — nothing to collect.`;
  }
  if (order.paymentStatus === "pending") {
    return "Online payment NOT confirmed yet — do not hand out; wait for the paid ticket.";
  }
  return "Payment at the restaurant.";
}

function infoRow(glyph: Glyph, label: string, text: string, bold = false): string {
  return (
    `<p class="row${bold ? " b" : ""}">` +
    `<span class="ico"><svg viewBox="0 0 24 24" width="14" height="14" role="img" aria-label="${esc(label)}">` +
    `<path d="${GLYPHS[glyph]}" fill="currentColor"/></svg></span>` +
    `<span class="txt">${esc(text)}</span></p>`
  );
}

/**
 * Render the whole ticket.
 *
 * `navQrSvg` is passed in rather than rendered here so this stays
 * synchronous and pure — the QR encoder is async, and a renderer that
 * can only be called with `await` is a renderer that cannot be a test
 * assertion or a template literal. Build it with
 * `renderQrSvg(ticketDirectionsUrl(ticketAddressLine(order)!))`.
 */
export function renderTicketHtml(
  order: TicketOrder,
  venue: TicketVenue,
  opts: TicketOptions & { navQrSvg?: string | null } = {},
): string {
  const locale = opts.locale || DEFAULT_LOCALE;
  const timeZone = venue.timezone || DEFAULT_TZ;
  const stamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  });
  const clock = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  const addressLine = ticketAddressLine(order);
  const money = (cents: number): string => formatPrice(cents, order.currency, locale);

  const rows: string[] = [];
  if (order.requestedFor) {
    rows.push(
      infoRow("clock", "ZEIT", `Geplant für ${clock.format(order.requestedFor)} Uhr`, true),
    );
  }
  if (order.orderType === "dine_in" && order.tableNumber) {
    rows.push(infoRow("table", "TISCH", `Tisch ${order.tableNumber}`, true));
  }
  if (order.customerName) rows.push(infoRow("person", "NAME", order.customerName));
  if (order.customerPhone) rows.push(infoRow("phone", "TEL", order.customerPhone));
  if (addressLine) rows.push(infoRow("pin", "ADR", addressLine));
  if (order.orderType === "delivery" && order.deliveryAddress?.note) {
    rows.push(infoRow("note", "INFO", order.deliveryAddress.note));
  }

  const items = order.items
    .map((item) => {
      const line =
        `<li><span class="qty">${item.quantity}x</span> <span class="nm">${esc(item.name)}</span>` +
        `<span class="amt">${esc(money(item.priceCents * item.quantity))}</span></li>`;
      // A per-line note belongs UNDER its dish, indented: the cook reads
      // the column of dish names first and the exception second.
      return item.note ? `${line}<li class="note">${esc(item.note)}</li>` : line;
    })
    .join("");

  const paid = paymentBanner(order);

  return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=302">
<title>${esc(`#${String(order.orderNumber).padStart(4, "0")} — ${venue.name}`)}</title>
<style>
@page { margin: 0; size: auto; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body {
  /* The ticket column is always 80 mm (302 px); the auto side margins centre
     it on anything wider — the phone's print preview, A4 paper, a PDF export
     — instead of pinning it to the left edge. Auto margins are horizontal
     only, so the ticket still starts at the top of the page. */
  width: 302px;
  margin: 0 auto;
  padding: 8px 10px 16px;
  font-family: "Menlo", "Consolas", "DejaVu Sans Mono", monospace;
  font-size: 13px;
  line-height: 1.32;
  -webkit-text-size-adjust: 100%;
}
p { margin: 0; }
.venue { text-align: center; font-size: 14px; font-weight: 700; text-transform: uppercase; }
.kind { margin-top: 2px; text-align: center; font-size: 11px; }
.rule { margin: 7px 0; overflow: hidden; white-space: nowrap; }
.head { display: flex; justify-content: space-between; font-weight: 700; }
.pay { margin-top: 2px; font-weight: 700; }
.banner {
  margin-top: 7px;
  border-top: 2px solid #000;
  border-bottom: 2px solid #000;
  padding: 3px 0;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .05em;
}
.rows { margin-top: 7px; }
.row { display: flex; gap: 7px; margin-top: 3px; }
.row.b { font-weight: 700; }
.ico { flex: 0 0 18px; display: flex; justify-content: center; padding-top: 2px; }
.txt { min-width: 0; word-break: break-word; }
.qr { margin-top: 10px; text-align: center; }
.qr svg { width: 140px; height: 140px; }
.qr p { margin-top: 3px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
ul { margin: 0; padding: 0; list-style: none; }
li { display: flex; justify-content: space-between; gap: 7px; margin-top: 3px; }
li.note { display: block; padding-left: 20px; font-size: 11px; font-style: italic; }
.qty { font-weight: 700; }
.nm { flex: 1 1 auto; min-width: 0; word-break: break-word; }
.amt { flex: 0 0 auto; white-space: nowrap; }
.total { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; }
.disc { display: flex; justify-content: space-between; }
.foot { margin-top: 7px; text-align: center; font-size: 11px; }
@media print {
  /* A receipt printer that honours the page size cuts to the roll instead of
     padding the ticket out to a letter/A4 sheet. One that ignores it falls
     back to the real paper, where the auto margins keep the column centred. */
  @page { size: 80mm auto; margin: 0; }
  body { width: 302px; margin: 0 auto; padding: 0 6px 6px; }
  .qr svg { width: 132px; height: 132px; }
}
</style>
</head>
<body>
<p class="venue">${esc(venue.name)}</p>
<p class="kind">Kitchen ticket</p>
<p class="rule">${RULE}</p>
<div class="head"><span>#${String(order.orderNumber).padStart(4, "0")}</span><span>${esc(stamp.format(order.createdAt))}</span></div>
${paid ? `<p class="pay">${esc(paid)}</p>` : ""}
<p class="banner">${esc(typeBanner(order))}</p>
${rows.length > 0 ? `<div class="rows">${rows.join("")}</div>` : ""}
${
  // Our own generated markup from our own qr lib — never user input.
  opts.navQrSvg
    ? `<div class="qr">${opts.navQrSvg}<p>&gt;&gt; Scan für Navigation &lt;&lt;</p></div>`
    : ""
}
<p class="rule">${RULE}</p>
<ul>${items}</ul>
<p class="rule">${RULE}</p>
${
  // The dishes keep their menu prices; the reward comes off here, so the
  // ticket's arithmetic matches the till.
  // The points are on the label so the counter can see what the guest
  // gave up for it; 0 means an order from before the column existed and
  // the row reads exactly as it always did.
  order.discountCents > 0
    ? `<div class="disc"><span>GUTSCHEIN / REWARD${
        order.discountPoints > 0 ? ` &middot; ${order.discountPoints} P` : ""
      }</span><span>-${esc(money(order.discountCents))}</span></div>`
    : ""
}
<div class="total"><span>TOTAL</span><span>${esc(money(order.totalCents))}</span></div>
<p class="foot">${esc(paymentFooter(order))}</p>
</body>
</html>`;
}
