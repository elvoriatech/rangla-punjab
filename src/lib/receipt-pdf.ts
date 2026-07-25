import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatPrice } from "./public-menu";
import type { ReceiptOrder } from "./order-service";

/**
 * Restaurant-standard receipt PDF: 80 mm thermal-roll width, monospace
 * face, centered venue header, dashed rules, qty × item lines with
 * right-aligned amounts, bold total. Fulfilment details (type, name,
 * phone, address, …) print as a tidy label/value two-column block. No
 * payment section — orders are settled at the restaurant; the footer says so.
 */

const WIDTH = 226.8; // 80 mm in PDF points
const MARGIN = 14;
const LINE = 11; // line height at 8.5 pt Courier
const FONT_SIZE = 8.5;
const LABEL_CHARS = 8; // width of the fulfilment label column, in characters

// Material "phone" handset, 24×24 viewbox — drawn as a vector because the
// WinAnsi Courier face has no phone glyph.
const PHONE_ICON_PATH =
  "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z";

function chunkName(name: string, maxChars: number): string[] {
  const words = name.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.slice(0, maxChars);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [name.slice(0, maxChars)];
}

/** One label/value row in the fulfilment block; `values` is already
 *  wrapped to the value column and sanitized. `icon` draws the phone glyph. */
interface FulfilmentRow {
  label: string;
  values: string[];
  icon?: boolean;
}

export async function buildReceiptPdf(
  order: ReceiptOrder,
  locale: string,
  /** Venue logo as PNG bytes (already resized small); omitted → text-only
   *  header. The receipt never mentions the platform — it is the
   *  restaurant's document. */
  logoPng?: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const mono = await doc.embedFont(StandardFonts.Courier);
  const monoBold = await doc.embedFont(StandardFonts.CourierBold);
  const logo = logoPng ? await doc.embedPng(logoPng).catch(() => null) : null;

  const price = (cents: number): string => formatPrice(cents, order.currency, locale);
  // Courier is fixed-width: usable chars per line at 8.5pt across 198.8pt.
  const charW = mono.widthOfTextAtSize("0", FONT_SIZE);
  const cols = Math.floor((WIDTH - 2 * MARGIN) / charW);
  const nameCols = cols - 12; // leave room for "NNx " and the price gutter
  const valueCols = Math.max(8, cols - LABEL_CHARS);

  // The Courier standard font is WinAnsi (CP1252) only: emoji and other
  // non-Latin characters throw when drawn or measured. Menu-facing surfaces
  // render "⏰ Planned for…" fine, but the receipt must strip anything the
  // font can't encode — from that emoji to an oddball char in a customer
  // name or delivery note — so the PDF always builds.
  const canEncode = (ch: string): boolean => {
    try {
      mono.encodeText(ch);
      return true;
    } catch {
      return false;
    }
  };
  const safe = (text: string): string => {
    let out = "";
    for (const ch of text) if (canEncode(ch)) out += ch;
    return out;
  };
  const wrap = (text: string): string[] => chunkName(safe(text), valueCols);

  // Fulfilment details as label/value rows, built from the order's fields.
  const scheduled = order.requestedFor
    ? new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      }).format(order.requestedFor)
    : null;
  const fRows: FulfilmentRow[] = [];
  if (order.orderType === "takeaway" || order.orderType === "delivery") {
    fRows.push({
      label: "Type",
      values: [order.orderType === "delivery" ? "Delivery" : "Pickup"],
    });
    if (scheduled) fRows.push({ label: "Planned", values: [scheduled] });
    if (order.customerName) fRows.push({ label: "Name", values: wrap(order.customerName) });
    if (order.customerPhone)
      fRows.push({ label: "Phone", values: [safe(order.customerPhone)], icon: true });
    if (order.orderType === "delivery" && order.deliveryAddress) {
      const a = order.deliveryAddress;
      const addr: string[] = [];
      if (a.street) addr.push(...wrap(a.street));
      const cityLine = `${a.zip ?? ""} ${a.city ?? ""}`.trim();
      if (cityLine) addr.push(...wrap(cityLine));
      if (addr.length > 0) fRows.push({ label: "Address", values: addr });
      if (a.note) fRows.push({ label: "Note", values: wrap(a.note) });
    }
  } else if (order.tableNumber) {
    fRows.push({ label: "Table", values: [order.tableNumber] });
  }
  const fulfilmentLineCount = fRows.reduce((n, r) => n + r.values.length, 0);

  // Pre-measure: item lines (name may wrap) + fixed chrome.
  const itemLines = order.items.map((it) => chunkName(it.name, nameCols));
  const bodyLines = itemLines.reduce((n, lines) => n + lines.length, 0);
  const LOGO_SIZE = 46;
  const height =
    110 + // header block
    (logo ? LOGO_SIZE + 8 : 0) +
    fulfilmentLineCount * LINE +
    (order.paymentStatus === "paid" ? LINE : 0) +
    bodyLines * LINE +
    110; // total + footer block

  const page = doc.addPage([WIDTH, height]);
  const ink = rgb(0.1, 0.1, 0.1);
  let y = height - 24;

  const center = (text: string, font = mono, size = FONT_SIZE): void => {
    const t = safe(text);
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: (WIDTH - w) / 2, y, size, font, color: ink });
    y -= LINE;
  };
  const left = (text: string, font = mono, size = FONT_SIZE): void => {
    page.drawText(safe(text), { x: MARGIN, y, size, font, color: ink });
    y -= LINE;
  };
  const spread = (l: string, r: string, font = mono, size = FONT_SIZE): void => {
    const rt = safe(r);
    page.drawText(safe(l), { x: MARGIN, y, size, font, color: ink });
    const w = font.widthOfTextAtSize(rt, size);
    page.drawText(rt, { x: WIDTH - MARGIN - w, y, size, font, color: ink });
    y -= LINE;
  };
  const rule = (): void => {
    center("-".repeat(cols));
  };
  // Label/value row: bold label in the left column, value(s) in the right.
  // The phone row draws a small vector handset before its number, since the
  // Courier face has no phone glyph.
  const valueX = MARGIN + LABEL_CHARS * charW;
  const fulfilmentRow = (r: FulfilmentRow): void => {
    page.drawText(safe(r.label), { x: MARGIN, y, size: FONT_SIZE, font: monoBold, color: ink });
    let vx = valueX;
    if (r.icon) {
      const icon = 7.5;
      page.drawSvgPath(PHONE_ICON_PATH, { x: vx, y: y + icon, scale: icon / 24, color: ink });
      vx += icon + 3;
    }
    page.drawText(r.values[0] ?? "", { x: vx, y, size: FONT_SIZE, font: mono, color: ink });
    y -= LINE;
    for (const cont of r.values.slice(1)) {
      page.drawText(cont, { x: valueX, y, size: FONT_SIZE, font: mono, color: ink });
      y -= LINE;
    }
  };

  // Header: logo (when the venue has one) above the name — nothing else.
  if (logo) {
    page.drawImage(logo, {
      x: (WIDTH - LOGO_SIZE) / 2,
      y: y - LOGO_SIZE + 8,
      width: LOGO_SIZE,
      height: LOGO_SIZE,
    });
    y -= LOGO_SIZE + 8;
  }
  for (const line of chunkName(order.venue.name.toUpperCase(), cols)) {
    center(line, monoBold, 10);
  }
  y -= LINE / 2;
  rule();
  spread(
    `Order #${String(order.orderNumber).padStart(4, "0")}`,
    new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(order.createdAt),
  );
  fRows.forEach(fulfilmentRow);
  if (order.paymentStatus === "paid") left("PAID ONLINE");
  rule();

  // Lines: "NNx Name.....   price" — wrapped names indent under the first.
  order.items.forEach((item, i) => {
    const qty = `${String(item.quantity).padStart(2, " ")}x `;
    const amount = price(item.priceCents * item.quantity);
    const lines = itemLines[i]!;
    spread(`${qty}${lines[0]!}`, amount);
    for (const cont of lines.slice(1)) left(`    ${cont}`);
  });

  rule();
  spread("TOTAL", price(order.totalCents), monoBold, 10);
  rule();
  y -= LINE / 2;
  center("Prices include VAT.");
  center("Payment is settled at the");
  center("restaurant - this is not");
  center("a tax invoice.");
  y -= LINE / 2;
  center("Thank you & see you soon!", monoBold);

  return doc.save();
}
