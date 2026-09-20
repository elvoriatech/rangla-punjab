import type { ReceiptOrder } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { newOrderCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { Button, EmailShell, Pill, styles, venueBrand } from "./layout";

/**
 * The owner's "new order" alert — the kitchen ticket in an inbox. Built to
 * be read on a phone between two other orders: the subject alone says what
 * came in, where it goes and what it's worth; the body is the ticket
 * (items, how the guest wants it, how they're paying) and one link to the
 * kitchen board. Table layout + inline styles in the shared branded shell
 * (`layout.tsx`) — what survives every mail client.
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
  // "voucher" = a loyalty reward settled the bill at placement. The
  // kitchen needs the same "nothing to collect" line an online payment
  // gets, without being told a card was charged.
  const paymentLine = paid
    ? order.paymentProvider === "voucher"
      ? t.paidVoucher
      : order.paymentProvider === "paypal"
        ? t.paidPaypal
        : t.paidCard
    : t.unpaid(money(order.totalCents));
  const when = order.requestedFor ? fmt.format(order.requestedFor) : t.asap;
  const addr = order.deliveryAddress;
  const addressLine = addr
    ? [addr.street, [addr.zip, addr.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : null;
  const rtl = dirFor(locale) === "rtl";
  const amountAlign = rtl ? ("left" as const) : ("right" as const);
  const right = { ...styles.itemCell, textAlign: amountAlign, whiteSpace: "nowrap" as const };
  const label = { ...styles.label, ...(rtl ? { padding: "6px 0 6px 12px" } : {}) };
  const rows: { icon: string; label: string; value: React.ReactNode }[] = [
    ...(order.customerName ? [{ icon: "👤", label: t.guest, value: order.customerName }] : []),
    ...(order.customerPhone
      ? [
          {
            icon: "📞",
            label: t.phone,
            value: (
              <a href={`tel:${order.customerPhone}`} style={{ color: "#8f1a1a" }}>
                {order.customerPhone}
              </a>
            ),
          },
        ]
      : []),
    ...(addressLine ? [{ icon: "📍", label: t.address, value: addressLine }] : []),
    ...(addr?.note ? [{ icon: "📝", label: t.addressNote, value: addr.note }] : []),
    { icon: "🕒", label: t.placedAt, value: fmt.format(order.createdAt) },
  ];

  return (
    <EmailShell
      lang={locale}
      dir={dirFor(locale)}
      brand={venueBrand(order.venue)}
      title={newOrderSubject(order, locale)}
      footer={t.footer}
    >
      <p style={styles.eyebrow}>{order.venue.name}</p>
      <h1 style={styles.h1}>{t.heading(orderNo(order))}</h1>
      <p style={{ margin: "0 0 6px", fontSize: 19, fontWeight: 700 }}>
        {typeIcon(order.orderType)} {whereLine(order, locale)}
        {order.orderType === "dine_in" && !order.tableNumber ? ` (${t.noTable})` : null}
        {order.orderType !== "dine_in" ? ` · ${t.planned} ${when}` : null}
      </p>
      <p style={{ margin: "0 0 18px" }}>
        <Pill text={paymentLine} tone={paid ? "ok" : "warn"} />
      </p>

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "collapse", marginBottom: 6 }}
      >
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={label}>
                {r.icon} {r.label}
              </td>
              <td style={styles.value}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr style={styles.hr} />
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
              <td style={{ ...styles.itemCell, fontSize: 16 }}>
                <strong>{item.quantity}×</strong> {item.name}
              </td>
              <td style={{ ...right, fontSize: 16 }}>{money(item.priceCents * item.quantity)}</td>
            </tr>
          ))}
          {order.discountCents > 0 ? (
            <tr>
              {/* Points as well as money: the restaurant reading this
                  needs to see that a reward was spent, and the number is
                  what makes the line legible as one. 0 = older order. */}
              <td style={{ ...styles.itemCell, fontSize: 16 }}>
                {order.discountPoints > 0 ? t.rewardPoints(String(order.discountPoints)) : t.reward}
              </td>
              <td style={{ ...right, fontSize: 16 }}>−{money(order.discountCents)}</td>
            </tr>
          ) : null}
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

      <hr style={styles.hr} />
      <Button href={kitchenUrl} label={t.open} />
    </EmailShell>
  );
}
