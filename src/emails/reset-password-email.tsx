/**
 * Password-reset email, in the shared branded shell.
 *
 * Two callers, one template:
 *   - the OWNER flow (`verification-service.ts`) sends it bare: platform
 *     brand, English, the wording it has always had;
 *   - the GUEST flow (`customer-password-reset.ts`) passes the venue's
 *     `brand` and a localised `copy` block, so the mail looks like it came
 *     from the restaurant the guest orders from and reads in their
 *     language.
 *
 * The English defaults live here rather than in the catalogue because the
 * owner mail is platform copy — it is not translated, and the guest
 * catalogue must stay free to say something different.
 */
import { BRAND } from "@/lib/brand";
import { guestResetCopy, type GuestResetCopy } from "@/lib/i18n/emails";
import { dirFor, uiLocale, type UiLocale } from "@/lib/locales";
import { Button, EmailShell, platformBrand, styles, type Brand } from "./layout";

export interface ResetPasswordEmailProps {
  resetUrl: string;
  /** Venue branding (guest variant); omitted ⇒ the platform brand. */
  brand?: Brand;
  /** Localised words (guest variant); omitted ⇒ the owner's English. */
  copy?: GuestResetCopy;
  locale?: UiLocale;
}

/** Subject line for the guest variant — the venue's name, their language. */
export function guestResetSubject(locale: UiLocale, venueName: string): string {
  return guestResetCopy(locale).subject(venueName || BRAND.name);
}

const ownerCopy: GuestResetCopy = {
  subject: (venue) => `Reset your ${venue} password`,
  eyebrow: BRAND.name,
  heading: `Reset your ${BRAND.name} password`,
  lead: "Choose a new password with the button below:",
  cta: "Choose a new password",
  orPaste: "Or paste this link into your browser:",
  expiry: "This link expires in 1 hour.",
  ignore:
    "If you did not request a reset, you can ignore this email — your password stays as it is.",
};

export function ResetPasswordEmail({
  resetUrl,
  brand,
  copy,
  locale,
}: ResetPasswordEmailProps): React.ReactElement {
  const t = copy ?? ownerCopy;
  const lang = uiLocale(locale ?? "en");
  return (
    <EmailShell
      lang={copy ? lang : "en"}
      dir={copy ? dirFor(lang) : "ltr"}
      brand={brand ?? platformBrand(BRAND.name)}
      title={t.heading}
      footer={t.ignore}
    >
      <p style={styles.eyebrow}>{t.eyebrow}</p>
      <h1 style={styles.h1}>{t.heading}</h1>
      <p style={styles.lead}>{t.lead}</p>
      <Button href={resetUrl} label={t.cta} />
      <p style={{ ...styles.muted, fontSize: 12, wordBreak: "break-all" }}>
        {t.orPaste}{" "}
        <a href={resetUrl} style={{ color: "#8f1a1a" }}>
          {resetUrl}
        </a>
      </p>
      <p style={{ ...styles.muted, fontSize: 12 }}>{t.expiry}</p>
    </EmailShell>
  );
}
