import { formatPrice } from "./public-menu";
import {
  paymentBanner,
  paymentFooter,
  ticketAddressLine,
  ticketVenueName,
  typeBanner,
  type TicketOrder,
  type TicketVenue,
} from "./ticket-html";

/**
 * The kitchen ticket as raw ESC/POS bytes, for a Bluetooth receipt printer
 * the restaurant app talks to directly (owner, 2026-10-09: "new orders must
 * print by themselves" — a phone's print dialog always needs a tap, a
 * printer spoken to over ESC/POS does not).
 *
 * Same content and order as `renderTicketHtml` — head, payment banner,
 * order type, guest rows, dishes, discounts, total, payment footer, then
 * the kitchen copy after a cut — set in the printer's own font. Two paper
 * widths: 58 mm (32 characters) and 80 mm (48).
 *
 * Text goes out in code page 437, which every ESC/POS printer has and
 * which carries ä ö ü ß; anything it lacks (€, typographic quotes, the
 * middle dot) is spelled out instead of printing as garbage.
 */

export type PaperWidth = 58 | 80;

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

const CP437: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ß: 0xe1,
};

/** Characters CP437 lacks, said in plain ASCII. */
const SPELLED: Record<string, string> = {
  "€": "EUR",
  "–": "-",
  "—": "-",
  "·": "-",
  "„": '"',
  "“": '"',
  "”": '"',
  "‚": "'",
  "‘": "'",
  "’": "'",
  "…": "...",
  " ": " ",
  " ": " ",
};

function encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const mapped = CP437[ch];
    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }
    const spelled = SPELLED[ch];
    if (spelled !== undefined) {
      for (const c of spelled) out.push(c.charCodeAt(0));
      continue;
    }
    const code = ch.charCodeAt(0);
    // Plain ASCII prints as itself; anything else falls back to its
    // accent-free base letter, or a "?" when there is none.
    if (code >= 0x20 && code < 0x7f) out.push(code);
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const b = base.charCodeAt(0);
      out.push(b >= 0x20 && b < 0x7f ? b : 0x3f);
    }
  }
  return out;
}

/** Word-wrap to `width` characters; a word longer than the line is cut. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** "2x Butter Chicken ......... 25,80 €" — the name wraps, the amount stays
 *  right-aligned on the first line. */
function twoColumns(left: string, right: string, width: number): string[] {
  const room = Math.max(8, width - right.length - 1);
  const parts = wrap(left, room);
  const first = parts[0] ?? "";
  const lines = [first + " ".repeat(Math.max(1, width - first.length - right.length)) + right];
  for (const rest of parts.slice(1)) lines.push(rest);
  return lines;
}

class Ticket {
  private bytes: number[] = [];
  constructor(readonly width: number) {}
  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  text(s: string): this {
    this.bytes.push(...encode(s));
    return this;
  }
  line(s = ""): this {
    return this.text(s).raw(0x0a);
  }
  lines(list: string[]): this {
    for (const l of list) this.line(l);
    return this;
  }
  align(where: "left" | "center" | "right"): this {
    return this.raw(ESC, 0x61, where === "left" ? 0 : where === "center" ? 1 : 2);
  }
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** 1 = normal, 2 = double width and height. */
  size(n: 1 | 2): this {
    return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00);
  }
  rule(): this {
    return this.line("-".repeat(this.width));
  }
  feed(n: number): this {
    return this.raw(ESC, 0x64, n);
  }
  /** Feed past the tear bar and cut (a printer without a cutter ignores it). */
  cut(): this {
    return this.feed(4).raw(GS, 0x56, 0x42, 0x00);
  }
  /** A QR code via GS ( k — model 2, error level M. */
  qr(data: string, moduleSize: number): this {
    const payload = Array.from(Buffer.from(data, "utf8"));
    const len = payload.length + 3;
    return this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00)
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize)
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31)
      .raw(GS, 0x28, 0x6b, len % 256, Math.floor(len / 256), 0x31, 0x50, 0x30, ...payload)
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export function renderTicketEscPos(
  order: TicketOrder,
  venue: TicketVenue,
  opts: {
    paper?: PaperWidth;
    locale?: string;
    /** The dispatch link for a delivery's driver QR (same as the HTML ticket). */
    navQrData?: string | null;
    kitchenCopy?: boolean;
  } = {},
): Uint8Array {
  const width = opts.paper === 58 ? 32 : 48;
  const locale = opts.locale || "de";
  const timeZone = venue.timezone || "Europe/Berlin";
  const stamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  });
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone });
  const money = (cents: number): string => formatPrice(cents, order.currency, locale);
  const name = ticketVenueName(venue.name);
  const number = `#${String(order.orderNumber)}`;
  const when = stamp.format(order.createdAt);

  const t = new Ticket(width);
  // Initialise, leave any Chinese double-byte mode, select code page 437.
  t.raw(ESC, 0x40).raw(FS, 0x2e).raw(ESC, 0x74, 0x00);

  t.align("center").bold(true).lines(wrap(name.main, width)).bold(false);
  if (name.sub) t.line(name.sub);
  t.line("Online-Bestellung").align("left").rule();

  t.size(2).bold(true).line(number).size(1).bold(false).line(when);
  const paid = paymentBanner(order);
  if (paid) t.bold(true).lines(wrap(paid, width)).bold(false);
  t.bold(true)
    .lines(wrap(typeBanner(order), width))
    .bold(false);

  if (order.requestedFor) {
    t.bold(true)
      .lines(wrap(`Geplant für ${clock.format(order.requestedFor)} Uhr`, width))
      .bold(false);
  }
  if (order.orderType === "dine_in" && order.tableNumber)
    t.bold(true).line(`Tisch ${order.tableNumber}`).bold(false);
  if (order.customerName) t.lines(wrap(`Name: ${order.customerName}`, width));
  if (order.customerPhone) t.lines(wrap(`Tel: ${order.customerPhone}`, width));
  const address = ticketAddressLine(order);
  if (address) t.lines(wrap(`Adresse: ${address}`, width));
  if (order.deliveryAddress?.note) t.lines(wrap(`Info: ${order.deliveryAddress.note}`, width));

  if (opts.navQrData) {
    t.align("center")
      .qr(opts.navQrData, width >= 48 ? 6 : 5)
      .feed(1);
    t.lines(wrap("Scan: unterwegs + Route", width)).align("left");
  }

  t.rule();
  for (const item of order.items) {
    t.lines(
      twoColumns(`${item.quantity}x ${item.name}`, money(item.priceCents * item.quantity), width),
    );
    if (item.note) t.lines(wrap(`  > ${item.note}`, width));
  }
  t.rule();
  if (order.discountCents > 0) {
    const label = `GUTSCHEIN${order.discountPoints > 0 ? ` - ${order.discountPoints} P` : ""}`;
    t.lines(twoColumns(label, `-${money(order.discountCents)}`, width));
  }
  if (order.giftCardDiscountCents > 0) {
    const label = `GESCHENKGUTSCHEIN${order.giftCardLast4 ? ` ****${order.giftCardLast4}` : ""}`;
    t.lines(twoColumns(label, `-${money(order.giftCardDiscountCents)}`, width));
  }
  t.bold(true)
    .lines(twoColumns("GESAMT", money(order.totalCents), width))
    .bold(false);
  t.align("center")
    .lines(wrap(paymentFooter(order), width))
    .align("left");
  t.cut();

  if (opts.kitchenCopy !== false) {
    t.align("center").bold(true).size(2).line("KÜCHENBON").size(1).bold(false).align("left");
    t.rule().size(2).bold(true).line(number).size(1).bold(false).line(when).rule();
    t.size(2);
    for (const item of order.items) {
      t.lines(wrap(`${item.quantity}x ${item.name}`, Math.floor(width / 2)));
      if (item.note)
        t.size(1)
          .lines(wrap(`  > ${item.note}`, width))
          .size(2);
    }
    t.size(1).rule();
    t.cut();
  }
  return t.done();
}
