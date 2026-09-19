import type { ReceiptOrder } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { newOrderCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";

/**
 * The owner's "new order" alert — the kitchen ticket in an inbox. Built to
 * be read on a phone between two other orders: the subject alone says what
 * came in, where it goes and what it's worth; the body is the ticket
 * (items, how the guest wants it, how they're paying) and one link to the
 * kitchen board. Same plain-HTML discipline as the receipt: no images, no
 * CSS that a mail client can strip.
 *
 * The words live in `src/lib/i18n/emails.ts`; this file is layout only.
 */
export interface NewOrderEmailProps {
  order: ReceiptOrder;
  locale: UiLocale;
  kitchenUrl: string;
}

function orderNo(order: ReceiptOrder): string {
  return String(order.orderNumber).padStart(4, "0");
}

/** One phrase for where the order goes: "Table 4", "Pickup", "Delivery". */
function whereLine(order: ReceiptOrder, locale: UiLocale): string {
  const t = newOrderCopy(locale);
  if (order.orderType === "delivery") return t.delivery;
  if (order.orderType === "takeaway") return t.pickup;
  return order.tableNumber ? t.table(order.tableNumber) : t.dineIn;
}

/** One glyph per fulfilment type, so a ticket is recognisable at arm's
 *  length: fork and knife, bag, scooter. Emoji render in every mail client
 *  the kitchen might read this on. */
function typeIcon(orderType: string): string {
  return orderType === "delivery" ? "🛵" : orderType === "takeaway" ? "🛍️" : "🍽️";
}

export function newOrderSubject(order: ReceiptOrder, locale: UiLocale): string {
  return newOrderCopy(locale).subject(
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
  const t = newOrderCopy(locale);
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
  // Amounts follow the reading direction, so an Arabic ticket mirrors
  // rather than stranding the prices on the wrong edge.
  const amountAlign = dirFor(locale) === "rtl" ? ("left" as const) : ("right" as const);
  const right = { ...cell, textAlign: amountAlign, whiteSpace: "nowrap" as const };
  // The label column's gutter is on the inner edge, which swaps in RTL.
  const gutter = dirFor(locale) === "rtl" ? { paddingLeft: 12 } : { paddingRight: 12 };
  const label = { ...cell, ...gutter, color: "#6b625a", whiteSpace: "nowrap" as const };

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body style={{ fontFamily: "Georgia, serif", color: "#1f1a17", lineHeight: 1.5 }}>
        <p style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          {order.venue.name}
        </p>
        <h1 style={{ fontSize: 24, margin: "4px 0 12px" }}>{t.heading(orderNo(order))}</h1>
        <p style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>
          {typeIcon(order.orderType)} {whereLine(order, locale)}
          {order.orderType === "dine_in" && !order.tableNumber ? ` (${t.noTable})` : null}
          {order.orderType !== "dine_in" ? ` · ${t.planned} ${when}` : null}
        </p>

        <table style={{ borderCollapse: "collapse", fontSize: 14, marginBottom: 12 }}>
          <tbody>
            {order.customerName ? (
              <tr>
                <td style={label}>👤 {t.guest}</td>
                <td style={cell}>{order.customerName}</td>
              </tr>
            ) : null}
            {order.customerPhone ? (
              <tr>
                <td style={label}>📞 {t.phone}</td>
                <td style={cell}>
                  <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
                </td>
              </tr>
            ) : null}
            {addressLine ? (
              <tr>
                <td style={label}>📍 {t.address}</td>
                <td style={cell}>{addressLine}</td>
              </tr>
            ) : null}
            {addr?.note ? (
              <tr>
                <td style={label}>📝 {t.addressNote}</td>
                <td style={cell}>{addr.note}</td>
              </tr>
            ) : null}
            <tr>
              <td style={label}>🕒 {t.placedAt}</td>
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
