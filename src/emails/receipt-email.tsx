import type { ReceiptOrder } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { receiptCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { vatFromGross } from "@/lib/vat";

/**
 * The guest's receipt by email — same numbers as the PDF (gross prices,
 * VAT shown as contained in the total), in the venue's language. Plain
 * HTML like the other templates: renders anywhere, survives every mail
 * client. The PDF stays one click away for anyone who needs a file.
 *
 * The words live in `src/lib/i18n/emails.ts`; this file is layout only.
 */
export interface ReceiptEmailProps {
  order: ReceiptOrder;
  locale: UiLocale;
  receiptUrl: string;
  trackUrl: string;
}

function orderNo(order: ReceiptOrder): string {
  return String(order.orderNumber).padStart(4, "0");
}

export function receiptSubject(order: ReceiptOrder, locale: UiLocale): string {
  return receiptCopy(locale).subject(orderNo(order), order.venue.name);
}

export function ReceiptEmail({
  order,
  locale,
  receiptUrl,
  trackUrl,
}: ReceiptEmailProps): React.ReactElement {
  const t = receiptCopy(locale);
  const money = (cents: number): string => formatPrice(cents, order.currency, locale);
  const vat = vatFromGross(order.totalCents);
  const net = order.totalCents - vat;
  const paid = order.paymentStatus === "paid";
  const paymentLine = paid
    ? order.paymentProvider === "paypal"
      ? t.paidPaypal
      : t.paidCard
    : order.orderType === "delivery"
      ? t.unpaidDelivery
      : order.orderType === "takeaway"
        ? t.unpaidPickup
        : t.unpaidDineIn;
  const when = order.requestedFor
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(order.requestedFor)
    : t.asap;
  const cell = { padding: "6px 0", verticalAlign: "top" as const };
  // The amount column follows the reading direction, so an Arabic receipt
  // puts it on the left the way the rest of the layout mirrors.
  const amountAlign = dirFor(locale) === "rtl" ? ("left" as const) : ("right" as const);
  const right = { ...cell, textAlign: amountAlign, whiteSpace: "nowrap" as const };

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body style={{ fontFamily: "Georgia, serif", color: "#1f1a17", lineHeight: 1.5 }}>
        <p style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          {order.venue.name}
        </p>
        <h1 style={{ fontSize: 24, margin: "4px 0 12px" }}>{t.heading(orderNo(order))}</h1>
        <p>{t.thanks}</p>
        <p style={{ fontSize: 14 }}>
          {order.orderType === "dine_in"
            ? order.tableNumber
              ? `${t.table} ${order.tableNumber}`
              : null
            : `${order.orderType === "delivery" ? t.delivery : t.pickup} · ${t.planned} ${when}`}
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e6dfd6" }}>
                <td style={cell}>
                  {item.quantity}× {item.name}
                </td>
                <td style={right}>{money(item.priceCents * item.quantity)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...cell, color: "#6b625a" }}>{t.net}</td>
              <td style={{ ...right, color: "#6b625a" }}>{money(net)}</td>
            </tr>
            <tr>
              <td style={{ ...cell, color: "#6b625a" }}>{t.vat}</td>
              <td style={{ ...right, color: "#6b625a" }}>{money(vat)}</td>
            </tr>
            <tr style={{ fontWeight: 700, borderTop: "2px solid #1f1a17" }}>
              <td style={cell}>{t.total}</td>
              <td style={right}>{money(order.totalCents)}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: "#6b625a" }}>{t.vatNote}</p>
        <p>
          <strong>{paymentLine}</strong>
        </p>
        <p>
          <a href={receiptUrl}>{t.pdf}</a>
          <br />
          <a href={trackUrl}>{t.track}</a>
        </p>
        <p style={{ fontSize: 12, color: "#6b625a" }}>{t.notInvoice}</p>
      </body>
    </html>
  );
}
