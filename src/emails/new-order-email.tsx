import type { ReceiptOrder } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";

/**
 * The owner's "new order" alert — the kitchen ticket in an inbox. Built to
 * be read on a phone between two other orders: the subject alone says what
 * came in, where it goes and what it's worth; the body is the ticket
 * (items, how the guest wants it, how they're paying) and one link to the
 * kitchen board. Same plain-HTML discipline as the receipt: no images, no
 * CSS that a mail client can strip.
 */
export interface NewOrderEmailProps {
  order: ReceiptOrder;
  locale: "de" | "en";
  kitchenUrl: string;
}

const COPY = {
  de: {
    subject: (n: string, where: string, total: string) =>
      `Neue Bestellung Nr. ${n} · ${where} · ${total}`,
    heading: (n: string) => `Neue Bestellung Nr. ${n}`,
    dineIn: "Im Restaurant",
    table: (t: string) => `Tisch ${t}`,
    noTable: "ohne Tischnummer",
    pickup: "Abholung",
    delivery: "Lieferung",
    planned: "Gewünscht für",
    asap: "so bald wie möglich",
    guest: "Gast",
    phone: "Telefon",
    address: "Adresse",
    addressNote: "Hinweis zur Adresse",
    total: "Gesamt",
    paidCard: "Online bezahlt (Karte) — nichts mehr kassieren.",
    paidPaypal: "Online bezahlt (PayPal) — nichts mehr kassieren.",
    unpaid: (total: string) => `Noch nicht bezahlt — ${total} vor Ort kassieren.`,
    open: "Bestellung in der Küchenansicht öffnen",
    placedAt: "Eingegangen",
    footer:
      "Diese Benachrichtigung geht an die Adressen unter Dashboard → Einstellungen → Bestellungen.",
  },
  en: {
    subject: (n: string, where: string, total: string) => `New order #${n} · ${where} · ${total}`,
    heading: (n: string) => `New order #${n}`,
    dineIn: "Dine-in",
    table: (t: string) => `Table ${t}`,
    noTable: "no table number",
    pickup: "Pickup",
    delivery: "Delivery",
    planned: "Wanted for",
    asap: "as soon as possible",
    guest: "Guest",
    phone: "Phone",
    address: "Address",
    addressNote: "Address note",
    total: "Total",
    paidCard: "Paid online (card) — nothing to collect.",
    paidPaypal: "Paid online (PayPal) — nothing to collect.",
    unpaid: (total: string) => `Not paid yet — collect ${total} on site.`,
    open: "Open the order on the kitchen board",
    placedAt: "Received",
    footer: "This alert goes to the addresses under Dashboard → Settings → Ordering.",
  },
} as const;

function orderNo(order: ReceiptOrder): string {
  return String(order.orderNumber).padStart(4, "0");
}

/** One phrase for where the order goes: "Table 4", "Pickup", "Delivery". */
function whereLine(order: ReceiptOrder, locale: "de" | "en"): string {
  const t = COPY[locale];
  if (order.orderType === "delivery") return t.delivery;
  if (order.orderType === "takeaway") return t.pickup;
  return order.tableNumber ? t.table(order.tableNumber) : t.dineIn;
}

export function newOrderSubject(order: ReceiptOrder, locale: "de" | "en"): string {
  return COPY[locale].subject(
    orderNo(order),
    whereLine(order, locale),
    formatPrice(order.totalCents, order.currency, locale),
  );
}

export function NewOrderEmail({
  order,
  locale,
  kitchenUrl,
}: NewOrderEmailProps): React.ReactElement {
  const t = COPY[locale];
  const money = (cents: number): string => formatPrice(cents, order.currency, locale);
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
  const paid = order.paymentStatus === "paid";
  const paymentLine = paid
    ? order.paymentProvider === "paypal"
      ? t.paidPaypal
      : t.paidCard
    : t.unpaid(money(order.totalCents));
  const when = order.requestedFor ? fmt.format(order.requestedFor) : t.asap;
  const addr = order.deliveryAddress;
  const addressLine = addr
    ? [addr.street, [addr.zip, addr.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : null;
  const cell = { padding: "6px 0", verticalAlign: "top" as const };
  const right = { ...cell, textAlign: "right" as const, whiteSpace: "nowrap" as const };
  const label = { ...cell, color: "#6b625a", paddingRight: 12, whiteSpace: "nowrap" as const };

  return (
    <html lang={locale}>
      <body style={{ fontFamily: "Georgia, serif", color: "#1f1a17", lineHeight: 1.5 }}>
        <p style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          {order.venue.name}
        </p>
        <h1 style={{ fontSize: 24, margin: "4px 0 12px" }}>{t.heading(orderNo(order))}</h1>
        <p style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>
          {whereLine(order, locale)}
          {order.orderType === "dine_in" && !order.tableNumber ? ` (${t.noTable})` : null}
          {order.orderType !== "dine_in" ? ` · ${t.planned} ${when}` : null}
        </p>

        <table style={{ borderCollapse: "collapse", fontSize: 14, marginBottom: 12 }}>
          <tbody>
            {order.customerName ? (
              <tr>
                <td style={label}>{t.guest}</td>
                <td style={cell}>{order.customerName}</td>
              </tr>
            ) : null}
            {order.customerPhone ? (
              <tr>
                <td style={label}>{t.phone}</td>
                <td style={cell}>
                  <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
                </td>
              </tr>
            ) : null}
            {addressLine ? (
              <tr>
                <td style={label}>{t.address}</td>
                <td style={cell}>{addressLine}</td>
              </tr>
            ) : null}
            {addr?.note ? (
              <tr>
                <td style={label}>{t.addressNote}</td>
                <td style={cell}>{addr.note}</td>
              </tr>
            ) : null}
            <tr>
              <td style={label}>{t.placedAt}</td>
              <td style={cell}>{fmt.format(order.createdAt)}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e6dfd6" }}>
                <td style={cell}>
                  <strong>{item.quantity}×</strong> {item.name}
                </td>
                <td style={right}>{money(item.priceCents * item.quantity)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: "2px solid #1f1a17" }}>
              <td style={cell}>{t.total}</td>
              <td style={right}>{money(order.totalCents)}</td>
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: 16 }}>
          <strong>{paymentLine}</strong>
        </p>
        <p>
          <a href={kitchenUrl}>{t.open}</a>
        </p>
        <p style={{ fontSize: 12, color: "#6b625a" }}>{t.footer}</p>
      </body>
    </html>
  );
}
