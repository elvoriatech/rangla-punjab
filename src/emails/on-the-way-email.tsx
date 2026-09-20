import { onTheWayCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { EMAIL, EmailShell, styles, venueBrand } from "./layout";

/**
 * "Your order is on the way" — the single delivery status ping, sent once
 * from `dispatch-service.ts` when an order flips to `out_for_delivery`
 * (a driver scans the ticket's dispatch QR, or staff tap it on the
 * board). Fire-and-forget: a mail failure must never block a dispatch.
 *
 * Deliberately the shortest template in here. The guest already has the
 * receipt, so there is no total, no item list and no button — just the
 * fact that the food left, where it is going, and "keep your phone near
 * you". Layout only; the words live in `src/lib/i18n/emails.ts` (all six
 * UI locales).
 */
export interface OnTheWayEmailProps {
  venue: {
    name: string;
    logoKey?: string | null;
    bannerKey?: string | null;
    primaryColor?: string | null;
  };
  locale: UiLocale;
  /** Raw counter; padded to the house four-digit form here. */
  orderNumber: number;
  /** Who ordered, or null for a guest who left the field blank. */
  customerName: string | null;
  /** One-line delivery address, already assembled by the caller, or null. */
  addressLine: string | null;
}

/** The house order-number format — "0031" — same as receipts and tickets. */
function orderNo(orderNumber: number): string {
  return String(orderNumber).padStart(4, "0");
}

export function onTheWaySubject(locale: UiLocale, orderNumber: number): string {
  return onTheWayCopy(locale).subject(orderNo(orderNumber));
}

export function OnTheWayEmail({
  venue,
  locale,
  orderNumber,
  customerName,
  addressLine,
}: OnTheWayEmailProps): React.ReactElement {
  const t = onTheWayCopy(locale);
  return (
    <EmailShell
      lang={locale}
      dir={dirFor(locale)}
      brand={venueBrand(venue)}
      title={t.heading}
      footer={
        <>
          {t.footer}
          <br />
          {venue.name}
        </>
      }
    >
      <p style={styles.eyebrow}>{t.eyebrow}</p>
      <h1 style={styles.h1}>{t.heading}</h1>
      {customerName ? <p style={{ margin: "0 0 8px" }}>{t.greeting(customerName)}</p> : null}
      <p style={styles.lead}>{t.lead(orderNo(orderNumber))}</p>

      {/* Where it is headed — quiet and bordered, so the guest can check
          the address at a glance without it competing with the heading. */}
      {addressLine ? (
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ borderCollapse: "collapse", margin: "0 0 18px" }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  backgroundColor: EMAIL.cream,
                  border: `1px solid ${EMAIL.line}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <div style={{ ...styles.eyebrow, marginBottom: 4 }}>{t.addressLabel}</div>
                <div style={{ fontSize: 15, color: EMAIL.ink }}>{addressLine}</div>
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}

      <p style={{ ...styles.muted, margin: 0 }}>{t.patience}</p>
    </EmailShell>
  );
}
