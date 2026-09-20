import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatPrice } from "./public-menu";
import { pdfCopy, pdfLocale } from "./i18n/pdf";
import { vatFromGross } from "./vat";
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
// Width of the fulfilment label column, in characters. 10 rather than 8 so
// the longest Spanish/Italian labels ("Direccion", "Indirizzo") fit without
// abbreviation; the value column still holds ~28 characters.
const LABEL_CHARS = 10;

// Material icons, 24×24 viewbox — drawn as vectors because the WinAnsi
// Courier face has no glyphs for them. One per fulfilment row: who, how to
// reach them, where, when, which table.
type RowIcon = keyof typeof ICON_PATHS;
const ICON_PATHS = {
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
 *  wrapped to the value column and sanitized. `icon` names the vector
 *  glyph drawn before the first value. */
interface FulfilmentRow {
  label: string;
  values: string[];
  icon?: RowIcon;
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

  // `ar` renders in English here (plan decision 4) — StandardFonts cannot
  // draw Arabic at all, so a "translated" PDF would come out blank rather
  // than merely English. The formats follow the same fallback.
  const intlLocale = pdfLocale(locale);
  const price = (cents: number): string => formatPrice(cents, order.currency, intlLocale);
  // Guest-facing copy in the guest's language. Labels stay <= LABEL_CHARS.
  const t = pdfCopy(locale);
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
    ? new Intl.DateTimeFormat(intlLocale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      }).format(order.requestedFor)
    : null;
  const fRows: FulfilmentRow[] = [];
  if (order.orderType === "takeaway" || order.orderType === "delivery") {
    fRows.push({
      label: t.type,
      values: [order.orderType === "delivery" ? t.delivery : t.pickup],
    });
    if (scheduled) fRows.push({ label: t.planned, values: [scheduled], icon: "clock" });
    if (order.customerName)
      fRows.push({ label: t.name, values: wrap(order.customerName), icon: "person" });
    if (order.customerPhone)
      fRows.push({ label: t.phone, values: [safe(order.customerPhone)], icon: "phone" });
    if (order.orderType === "delivery" && order.deliveryAddress) {
      const a = order.deliveryAddress;
      const addr: string[] = [];
      if (a.street) addr.push(...wrap(a.street));
      const cityLine = `${a.zip ?? ""} ${a.city ?? ""}`.trim();
      if (cityLine) addr.push(...wrap(cityLine));
      if (addr.length > 0) fRows.push({ label: t.address, values: addr, icon: "pin" });
      if (a.note) fRows.push({ label: t.note, values: wrap(a.note), icon: "note" });
    }
  } else if (order.tableNumber) {
    fRows.push({ label: t.table, values: [order.tableNumber], icon: "table" });
  }
  const fulfilmentLineCount = fRows.reduce((n, r) => n + r.values.length, 0);

  // Pre-measure: item lines (name may wrap) + fixed chrome.
  const itemLines = order.items.map((it) => chunkName(it.name, nameCols));
  const bodyLines = itemLines.reduce((n, lines) => n + lines.length, 0);
  const LOGO_SIZE = 46;
  // A loyalty reward prints as its own row between the lines and the
  // net/VAT split: the dishes keep their menu prices (the kitchen and the
  // tax record both need those), and the discount is visible as the thing
  // that brought the total down.
  const discountCents = Math.max(0, order.discountCents);
  // The POINTS the reward cost, on the row itself — a guest reading
  // "Reward -20,00" a week later has no way to tell what they gave up for
  // it. 0 means the order predates the column, and the row then reads as
  // it always did rather than claiming the reward was free.
  const rewardLabel =
    order.discountPoints > 0 ? t.rewardPoints(String(order.discountPoints)) : t.reward;
  // A gift card is its own row directly under the reward: a guest may pay
  // with both on one order, and each has to be readable as the separate
  // thing it is. The masked last 4 identify WHICH card — the guest may
  // hold several, and "which one did I burn" is the question a receipt
  // has to answer a week later.
  const giftCardCents = Math.max(0, order.giftCardDiscountCents);
  const giftCardLabel = order.giftCardLast4 ? t.giftCardCode(order.giftCardLast4) : t.giftCard;
  const paidByReward = order.paymentStatus === "paid" && order.paymentProvider === "voucher";
  const paidByGiftCard = order.paymentStatus === "paid" && order.paymentProvider === "gift_card";
  const height =
    110 + // header block
    (logo ? LOGO_SIZE + 8 : 0) +
    fulfilmentLineCount * LINE +
    (order.paymentStatus === "paid" ? LINE : 0) +
    bodyLines * LINE +
    (discountCents > 0 ? LINE : 0) + // the reward row
    (giftCardCents > 0 ? LINE : 0) + // the gift-card row
    2 * LINE + // net + VAT rows above the total
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
  // Rows with an icon draw a small vector glyph before their first value,
  // since the Courier face has none of these symbols.
  const valueX = MARGIN + LABEL_CHARS * charW;
  const fulfilmentRow = (r: FulfilmentRow): void => {
    page.drawText(safe(r.label), { x: MARGIN, y, size: FONT_SIZE, font: monoBold, color: ink });
    let vx = valueX;
    if (r.icon) {
      const icon = 7.5;
      page.drawSvgPath(ICON_PATHS[r.icon], { x: vx, y: y + icon, scale: icon / 24, color: ink });
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
    `${t.order} ${String(order.orderNumber).padStart(4, "0")}`,
    new Intl.DateTimeFormat(intlLocale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(order.createdAt),
  );
  fRows.forEach(fulfilmentRow);
  if (order.paymentStatus === "paid")
    left(paidByGiftCard ? t.paidWithGiftCard : paidByReward ? t.paidReward : t.paidOnline);
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
  // The reward comes off the bill before the tax split: `order.totalCents`
  // is already the charged amount, so the VAT below is the VAT on what the
  // guest actually paid.
  if (discountCents > 0) spread(rewardLabel, `-${price(discountCents)}`);
  if (giftCardCents > 0) spread(giftCardLabel, `-${price(giftCardCents)}`);
  // German gross pricing: the total already includes 19 % VAT — show the
  // net/VAT split so the receipt doubles as a tax-transparent record.
  const vatCents = vatFromGross(order.totalCents);
  const netCents = order.totalCents - vatCents;
  spread(t.net, price(netCents));
  spread(t.vat, price(vatCents));
  spread(t.total, price(order.totalCents), monoBold, 10);
  rule();
  y -= LINE / 2;
  center(t.vatNote);
  for (const line of paidByGiftCard
    ? [t.paidWithGiftCard]
    : paidByReward
      ? t.paidWithReward
      : order.paymentStatus === "paid"
        ? t.paid
        : t.unpaid) {
    center(line);
  }
  y -= LINE / 2;
  center(t.thanks, monoBold);

  return doc.save();
}
