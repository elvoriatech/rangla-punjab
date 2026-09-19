import { rewardCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { Button, EMAIL, EmailShell, styles, venueBrand } from "./layout";

/**
 * "You've earned a free meal" — the one email the loyalty feature sends.
 * Fired once per voucher, at the moment the points convert, from
 * `loyalty-service.ts`. Fire-and-forget: a mail failure must never turn a
 * settled payment into an error, so the caller swallows it.
 *
 * Layout only; the words live in `src/lib/i18n/emails.ts` (all five UI
 * locales) and the money/date are pre-formatted by the caller so this
 * component never guesses a currency or a timezone.
 */
export interface RewardEmailProps {
  venue: {
    name: string;
    logoKey?: string | null;
    bannerKey?: string | null;
    primaryColor?: string | null;
  };
  locale: UiLocale;
  /** Pre-formatted voucher value, e.g. "20,00 €". */
  value: string;
  /** Pre-formatted expiry date in the VENUE's timezone. */
  expires: string;
  /** Where "See my rewards" goes — the guest account page. */
  rewardsUrl: string;
}

export function rewardSubject(locale: UiLocale, value: string): string {
  return rewardCopy(locale).subject(value);
}

export function RewardEmail({
  venue,
  locale,
  value,
  expires,
  rewardsUrl,
}: RewardEmailProps): React.ReactElement {
  const t = rewardCopy(locale);
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

      {/* The amount, once, big — the single fact the guest is scanning for. */}
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
              align="center"
              style={{
                backgroundColor: EMAIL.cream,
                border: `2px dashed ${EMAIL.gold}`,
                borderRadius: 14,
                padding: "18px 16px",
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 700, color: EMAIL.accent }}>{value}</div>
              <div style={{ ...styles.muted, marginTop: 4 }}>{t.expiry(expires)}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <p style={{ margin: "0 0 16px" }}>{t.whereToFind}</p>
      <div>
        <Button href={rewardsUrl} label={t.cta} />
      </div>
      <hr style={styles.hr} />
      <p style={{ ...styles.muted, margin: 0 }}>{t.keepGoing}</p>
    </EmailShell>
  );
}
