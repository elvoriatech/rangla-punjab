import { giftCardCopy, giftCardRedeemedCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { Button, EMAIL, EmailShell, styles, venueBrand } from "./layout";

/**
 * The two gift-card emails.
 *
 *  - `GiftCardEmail` — the buyer's confirmation, sent once, the moment the
 *    payment settles. This is the nicest thing the product puts in an
 *    inbox: it is the artefact somebody forwards, screenshots or reads out
 *    loud, so the CODE is the hero and everything else defers to it.
 *  - `GiftCardRedeemedEmail` — a short note to the same buyer when the
 *    card is spent. Deliberately plain: there is nothing left to do.
 *
 * Layout only. The words live in `src/lib/i18n/emails.ts` (all six UI
 * locales) and every value — money, dates, the dashed code — arrives
 * pre-formatted from `gift-card-service.ts`, so this file never touches
 * `Intl`, a currency or a timezone.
 */

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace";

export interface GiftCardEmailProps {
  venue: {
    name: string;
    logoKey?: string | null;
    bannerKey?: string | null;
    primaryColor?: string | null;
  };
  locale: UiLocale;
  /** Pre-formatted card value, e.g. "50,00 €". */
  value: string;
  /** Already dashed for reading aloud, e.g. "ABCD-2345-EFGH". */
  code: string;
  /** The named product ("Dinner for two"), or null for a plain value card. */
  productName: string | null;
  /** Who the buyer said it was for, or null. */
  recipientName: string | null;
  /** Pre-formatted expiry date in the VENUE's timezone. */
  expires: string;
  /** The public card page the buyer forwards to the recipient. */
  shareUrl: string;
}

export function giftCardSubject(locale: UiLocale, venueName: string): string {
  return giftCardCopy(locale).subject(venueName);
}

export function GiftCardEmail({
  venue,
  locale,
  value,
  code,
  productName,
  recipientName,
  expires,
  shareUrl,
}: GiftCardEmailProps): React.ReactElement {
  const t = giftCardCopy(locale);
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
      <p style={styles.lead}>{t.lead(value)}</p>

      {/* Who and what, when the buyer told us — one quiet line each, above
          the code, so the card reads as a named gift and not a receipt. */}
      {recipientName || productName ? (
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ borderCollapse: "collapse", margin: "0 0 16px" }}
        >
          <tbody>
            {recipientName ? (
              <tr>
                <td style={{ ...styles.value, padding: "2px 0", fontWeight: 700 }}>
                  {t.forLabel(recipientName)}
                </td>
              </tr>
            ) : null}
            {productName ? (
              <tr>
                <td style={{ ...styles.muted, padding: "2px 0" }}>
                  {t.productLabel}: {productName}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}

      {/* THE CODE. Big, monospace, wide-tracked and boxed, because this is
          what gets read across a room and screenshotted. `dir="ltr"` on the
          code itself so an Arabic mail never reorders the groups. */}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "collapse", margin: "0 0 14px" }}
      >
        <tbody>
          <tr>
            <td
              align="center"
              style={{
                backgroundColor: EMAIL.cream,
                border: `2px solid ${EMAIL.gold}`,
                borderRadius: 16,
                padding: "20px 14px 18px",
              }}
            >
              <div
                style={{
                  ...styles.eyebrow,
                  marginBottom: 10,
                  color: EMAIL.accentDark,
                }}
              >
                {t.codeLabel}
              </div>
              <div
                dir="ltr"
                style={{
                  fontFamily: MONO,
                  fontSize: 27,
                  lineHeight: 1.25,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  color: EMAIL.ink,
                  wordBreak: "break-word",
                }}
              >
                {code}
              </div>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 20,
                  fontWeight: 700,
                  color: EMAIL.accent,
                }}
              >
                {value}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <p style={{ margin: "0 0 6px" }}>{t.howTo}</p>
      <p style={{ ...styles.muted, margin: "0 0 18px" }}>{t.expiry(expires)}</p>

      <div>
        <Button href={shareUrl} label={t.cta} />
      </div>
      <p style={{ ...styles.muted, margin: "8px 0 0" }}>{t.shareHint}</p>

      <hr style={styles.hr} />
      <p style={{ ...styles.muted, margin: 0 }}>{t.legal}</p>
    </EmailShell>
  );
}

export interface GiftCardRedeemedEmailProps {
  venue: {
    name: string;
    logoKey?: string | null;
    bannerKey?: string | null;
    primaryColor?: string | null;
  };
  locale: UiLocale;
  /** Pre-formatted card value, e.g. "50,00 €". */
  value: string;
  /** Already dashed, e.g. "ABCD-2345-EFGH". */
  code: string;
  /** Pre-formatted redemption date in the VENUE's timezone. */
  redeemedOn: string;
}

export function giftCardRedeemedSubject(locale: UiLocale, venueName: string): string {
  return giftCardRedeemedCopy(locale).subject(venueName);
}

export function GiftCardRedeemedEmail({
  venue,
  locale,
  value,
  code,
  redeemedOn,
}: GiftCardRedeemedEmailProps): React.ReactElement {
  const t = giftCardRedeemedCopy(locale);
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
      <p style={styles.lead}>{t.lead(value)}</p>

      {/* The card is spent, so the code is a reference, not a hero: small,
          muted, just enough to match this mail to the right purchase. */}
      <p style={{ ...styles.muted, margin: "0 0 4px" }}>
        {t.codeLabel}:{" "}
        <span dir="ltr" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
          {code}
        </span>
      </p>
      <p style={{ ...styles.muted, margin: 0 }}>{t.onLabel(redeemedOn)}</p>
    </EmailShell>
  );
}
