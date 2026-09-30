/* eslint-disable @next/next/no-head-element, @next/next/no-img-element -- this is
   email HTML, not a Next page: a real <head> and plain <img> are exactly right. */
import type { CSSProperties, ReactNode } from "react";
import { siteUrl } from "@/lib/site-url";
import { uploadedImageUrl } from "@/lib/menu-images";

/**
 * One frame for every email the app sends except the order confirmation,
 * which draws the same frame itself (`receipt-email.tsx`): the owner asked
 * for ONE look across all notifications (2026-09-30) — the green design of
 * the confirmation. A white rounded card on a pale-green page, the brand
 * header image on top, the email's own content below, a quiet footer.
 *
 * The header is ONE image (`/brand/email-header.png`, the mascot + chunky
 * lettering + halal mark) because custom fonts don't survive Gmail/Outlook;
 * its alt text is the venue name, so an image-blocking client still says
 * who wrote. Table layout + inline styles only.
 *
 * Only the FRAME is shared. Each email keeps its own message — the "Thank
 * you, your order has been received" card belongs to the confirmation
 * alone.
 */

export const EMAIL = {
  /** Buttons, headings' accents, amounts — the confirmation's green. */
  accent: "#1e5b2c",
  accentDark: "#0f3d1f",
  /** Border of highlighted boxes (vouchers, gift cards). */
  gold: "#b9d88a",
  /** Background of highlighted boxes ("delivering to", codes). */
  cream: "#eaf4e2",
  card: "#ffffff",
  ink: "#1f2a1f",
  inkSoft: "#5f6b5f",
  line: "#e3e8de",
  positive: "#1e5b2c",
  positiveBg: "#e3f2e1",
  warnBg: "#fde8e8",
} as const;

/** The page behind the card. */
const PAGE = "#f3f5ef";
const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const SANS = FONT;

export interface Brand {
  name: string;
  /** Absolute URL of a square logo, or null. Kept for callers; the green
   *  frame's header is the brand image instead. */
  logoUrl: string | null;
  /** Absolute URL of a wide banner photo, or null. Kept for callers; no
   *  longer drawn (owner, 2026-09-30: one green look everywhere). */
  bannerUrl: string | null;
  accent?: string | null;
}

/** Brand block for a venue with uploaded assets (receipts, kitchen tickets). */
export function venueBrand(venue: {
  name: string;
  logoKey?: string | null;
  bannerKey?: string | null;
  primaryColor?: string | null;
}): Brand {
  const base = siteUrl();
  return {
    name: venue.name,
    logoUrl: venue.logoKey ? `${base}${uploadedImageUrl(venue.logoKey, 192)}` : null,
    bannerUrl: venue.bannerKey ? `${base}${uploadedImageUrl(venue.bannerKey, 1280)}` : null,
    accent: venue.primaryColor ?? null,
  };
}

/** Brand block for platform emails (account, billing): the deployment's own
 *  logo from /public/brand, which is the restaurant's in a white-label build. */
export function platformBrand(name: string): Brand {
  return { name, logoUrl: `${siteUrl()}/brand/logo-192.png`, bannerUrl: null, accent: null };
}

export function EmailShell({
  lang,
  dir,
  brand,
  title,
  children,
  footer,
}: {
  lang: string;
  dir: "ltr" | "rtl";
  brand: Brand;
  /** Also the hidden preheader most clients show next to the subject. */
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}): React.ReactElement {
  const headerUrl = `${siteUrl()}/brand/email-header.png`;
  return (
    <html lang={lang} dir={dir}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <meta name="color-scheme" content="light" />
        <title>{title}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: PAGE, fontFamily: FONT }}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>{title}</div>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: PAGE }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "20px 10px" }}>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  dir={dir}
                  style={{
                    width: "100%",
                    maxWidth: 600,
                    backgroundColor: EMAIL.card,
                    borderRadius: 18,
                    overflow: "hidden",
                  }}
                >
                  <tbody>
                    {/* Brand header — the same image the confirmation opens with. */}
                    <tr>
                      <td align="center" style={{ padding: "18px 16px 6px" }}>
                        <img
                          src={headerUrl}
                          width={560}
                          alt={brand.name}
                          style={{
                            display: "block",
                            width: "100%",
                            maxWidth: 560,
                            height: "auto",
                            border: 0,
                            color: EMAIL.accent,
                            fontFamily: FONT,
                            fontSize: 22,
                            fontWeight: 700,
                          }}
                        />
                      </td>
                    </tr>
                    {/* The email's own content. */}
                    <tr>
                      <td
                        style={{
                          padding: "18px 28px 26px",
                          color: EMAIL.ink,
                          fontSize: 15,
                          lineHeight: 1.55,
                          fontFamily: FONT,
                        }}
                      >
                        {children}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ width: "100%", maxWidth: 600 }}
                >
                  <tbody>
                    <tr>
                      <td
                        align="center"
                        style={{
                          padding: "16px 12px 0",
                          color: EMAIL.inkSoft,
                          fontSize: 12,
                          lineHeight: 1.5,
                          fontFamily: SANS,
                        }}
                      >
                        {footer}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

/* ---- Building blocks, all inline-styled ---- */

export const styles = {
  eyebrow: {
    margin: 0,
    color: EMAIL.inkSoft,
    fontSize: 11,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    fontFamily: SANS,
  } as CSSProperties,
  h1: {
    margin: "4px 0 14px",
    fontSize: 26,
    lineHeight: 1.2,
    color: EMAIL.accentDark,
    fontFamily: FONT,
  } as CSSProperties,
  lead: { margin: "0 0 18px", fontSize: 15, color: EMAIL.ink } as CSSProperties,
  muted: { color: EMAIL.inkSoft, fontSize: 13 } as CSSProperties,
  hr: { border: 0, borderTop: `1px solid ${EMAIL.line}`, margin: "18px 0" } as CSSProperties,
  label: {
    padding: "6px 12px 6px 0",
    color: EMAIL.inkSoft,
    fontSize: 13,
    whiteSpace: "nowrap",
    verticalAlign: "top",
    fontFamily: SANS,
  } as CSSProperties,
  value: { padding: "6px 0", fontSize: 15, verticalAlign: "top" } as CSSProperties,
  itemCell: {
    padding: "9px 0",
    borderBottom: `1px solid ${EMAIL.line}`,
    fontSize: 15,
    verticalAlign: "top",
  } as CSSProperties,
  totalCell: { padding: "12px 0 4px", fontSize: 17, fontWeight: 700 } as CSSProperties,
};

/** A bulletproof button: a table cell with a background, so it renders as a
 *  button everywhere and stays a plain link where images are blocked. */
export function Button({
  href,
  label,
  tone = "accent",
}: {
  href: string;
  label: string;
  tone?: "accent" | "outline";
}): React.ReactElement {
  const solid = tone === "accent";
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{ display: "inline-table", margin: "6px 8px 6px 0" }}
    >
      <tbody>
        <tr>
          <td
            style={{
              borderRadius: 999,
              backgroundColor: solid ? EMAIL.accent : EMAIL.card,
              border: `2px solid ${EMAIL.accent}`,
              padding: "10px 20px",
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            <a
              href={href}
              style={{
                color: solid ? "#ffffff" : EMAIL.accent,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              {label}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Status pill: settled (green) or open (warm). */
export function Pill({ text, tone }: { text: string; tone: "ok" | "warn" }): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 999,
        padding: "5px 12px",
        fontFamily: SANS,
        fontSize: 13,
        fontWeight: 700,
        backgroundColor: tone === "ok" ? EMAIL.positiveBg : EMAIL.warnBg,
        color: tone === "ok" ? EMAIL.positive : EMAIL.accentDark,
        border: `1px solid ${tone === "ok" ? EMAIL.positive : EMAIL.accent}`,
      }}
    >
      {text}
    </span>
  );
}
