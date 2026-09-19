import type { ReceiptOrder } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { receiptCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { vatFromGross } from "@/lib/vat";
import { Button, EmailShell, Pill, styles, venueBrand } from "./layout";

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
  const amountAlign = dirFor(locale) === "rtl" ? ("left" as const) : ("right" as const);
  const right = { ...styles.itemCell, textAlign: amountAlign, whiteSpace: "nowrap" as const };
  const typeIcon =
    order.orderType === "delivery" ? "🛵" : order.orderType === "takeaway" ? "🛍️" : "🍽️";
  const whereLine =
    order.orderType === "dine_in"
      ? order.tableNumber
        ? `${t.table} ${order.tableNumber}`
        : null
      : `${order.orderType === "delivery" ? t.delivery : t.pickup} · ${t.planned} ${when}`;

  return (
    <EmailShell
      lang={locale}
      dir={dirFor(locale)}
      brand={venueBrand(order.venue)}
      title={t.heading(orderNo(order))}
      footer={
        <>
          {t.notInvoice}
          <br />
          {order.venue.name}
        </>
      }
    >
      <p style={styles.eyebrow}>{order.venue.name}</p>
      <h1 style={styles.h1}>{t.heading(orderNo(order))}</h1>
      <p style={styles.lead}>{t.thanks}</p>

      {whereLine ? (
        <p style={{ margin: "0 0 6px", fontSize: 15 }}>
          {typeIcon} {whereLine}
        </p>
      ) : null}
      <p style={{ margin: "0 0 18px" }}>
        <Pill text={paymentLine} tone={paid ? "ok" : "warn"} />
      </p>

      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "collapse" }}
      >
        <tbody>
          {order.items.map((item, i) => (
            <tr key={i}>
              <td style={styles.itemCell}>
                <strong>{item.quantity}×</strong> {item.name}
              </td>
              <td style={right}>{money(item.priceCents * item.quantity)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...styles.value, ...styles.muted, paddingTop: 12 }}>{t.net}</td>
            <td
              style={{ ...styles.value, ...styles.muted, paddingTop: 12, textAlign: amountAlign }}
            >
              {money(net)}
            </td>
          </tr>
          <tr>
            <td style={{ ...styles.value, ...styles.muted }}>{t.vat}</td>
            <td style={{ ...styles.value, ...styles.muted, textAlign: amountAlign }}>
              {money(vat)}
            </td>
          </tr>
          <tr>
            <td style={{ ...styles.totalCell, borderTop: "2px solid #360a0a" }}>{t.total}</td>
            <td
              style={{
                ...styles.totalCell,
                borderTop: "2px solid #360a0a",
                textAlign: amountAlign,
                whiteSpace: "nowrap",
              }}
            >
              {money(order.totalCents)}
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ ...styles.muted, margin: "6px 0 0", fontSize: 12 }}>{t.vatNote}</p>

      <hr style={styles.hr} />
      <div>
        <Button href={receiptUrl} label={t.pdf} tone="outline" />
        <Button href={trackUrl} label={t.track} />
      </div>
    </EmailShell>
  );
}
