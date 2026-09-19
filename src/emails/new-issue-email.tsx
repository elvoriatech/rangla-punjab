import { newIssueCopy } from "@/lib/i18n/emails";
import { dirFor, type UiLocale } from "@/lib/locales";
import { Button, EmailShell, Pill, styles, venueBrand } from "./layout";

/**
 * "A guest says their food was cold." The owner's alert for a complaint
 * thread — sent on the guest's first message and on every follow-up, never
 * on the restaurant's own replies.
 *
 * Deliberately thin: order number, who wrote it, their own words, and one
 * button into the thread. The person reading this is the one who cooked
 * the food; a summary would only get between them and what was said.
 *
 * The words live in `src/lib/i18n/emails.ts`; this file is layout only.
 */
export interface NewIssueEmailProps {
  issue: {
    orderNumber: number;
    orderPlacedAt: Date;
    customerName: string | null;
    customerPhone: string | null;
    /** The message this alert is about — always a guest one. */
    message: { body: string; hasPhoto: boolean; createdAt: Date };
    venue: {
      name: string;
      logoKey: string | null;
      bannerKey: string | null;
      primaryColor: string | null;
    };
  };
  locale: UiLocale;
  /** Absolute link to the dashboard thread page. */
  issueUrl: string;
}

function orderNo(orderNumber: number): string {
  return String(orderNumber).padStart(4, "0");
}

export function newIssueSubject(orderNumber: number, locale: UiLocale): string {
  return newIssueCopy(locale).subject(orderNo(orderNumber));
}

export function NewIssueEmail({ issue, locale, issueUrl }: NewIssueEmailProps): React.ReactElement {
  const t = newIssueCopy(locale);
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
  const rtl = dirFor(locale) === "rtl";
  const label = { ...styles.label, ...(rtl ? { padding: "6px 0 6px 12px" } : {}) };
  const rows: { icon: string; label: string; value: React.ReactNode }[] = [
    ...(issue.customerName ? [{ icon: "👤", label: t.guest, value: issue.customerName }] : []),
    ...(issue.customerPhone
      ? [
          {
            icon: "📞",
            label: t.phone,
            value: (
              <a href={`tel:${issue.customerPhone}`} style={{ color: "#8f1a1a" }}>
                {issue.customerPhone}
              </a>
            ),
          },
        ]
      : []),
    { icon: "🧾", label: t.placedAt, value: fmt.format(issue.orderPlacedAt) },
    { icon: "🕒", label: t.reportedAt, value: fmt.format(issue.message.createdAt) },
  ];

  return (
    <EmailShell
      lang={locale}
      dir={dirFor(locale)}
      brand={venueBrand(issue.venue)}
      title={newIssueSubject(issue.orderNumber, locale)}
      footer={t.footer}
    >
      <p style={styles.eyebrow}>{t.eyebrow}</p>
      <h1 style={styles.h1}>{t.heading(orderNo(issue.orderNumber))}</h1>
      <p style={styles.lead}>{t.lead}</p>
      <p style={{ margin: "0 0 18px" }}>
        <Pill text={t.pill} tone="warn" />
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
      <p style={{ ...styles.eyebrow, marginBottom: 8 }}>{t.message}</p>
      {/* The guest's own words, quoted rather than paraphrased. `pre-wrap`
          keeps the line breaks they typed; the block quote makes it plain
          where our voice stops and theirs starts. */}
      <blockquote
        style={{
          margin: 0,
          padding: "12px 16px",
          borderInlineStart: "3px solid #e8c15c",
          backgroundColor: "#fdf4e0",
          borderRadius: 8,
          fontSize: 16,
          whiteSpace: "pre-wrap",
        }}
      >
        {issue.message.body}
      </blockquote>
      {issue.message.hasPhoto ? (
        <p style={{ ...styles.muted, margin: "12px 0 0" }}>📷 {t.photo}</p>
      ) : null}

      <hr style={styles.hr} />
      <Button href={issueUrl} label={t.open} />
    </EmailShell>
  );
}
