/* eslint-disable @next/next/no-head-element, @next/next/no-img-element -- this is
   email HTML, not a Next page: a real <head> and plain <img> are exactly right. */
import type { CSSProperties, ReactNode } from "react";
import { siteUrl } from "@/lib/site-url";
import { uploadedImageUrl } from "@/lib/menu-images";

/**
 * One branded frame for every email the app sends: a header carrying the
 * venue's identity, a card for the content, and a quiet footer. Table
 * layout + inline styles only — that is what survives Gmail, Outlook and
 * Apple Mail alike. Images are absolute URLs on our own origin (the same
 * `/img` route the site uses).
 *
 * The header has two shapes:
 *
 *  - **With a banner photo** — the photo is the header cell's BACKGROUND
 *    (both the `background` attribute and `background-image`, because
 *    different clients honour different ones) and the logo medallion, the
 *    name and the stars sit centred ON it. No second coloured band below:
 *    one header, one image. A client that drops background images (Outlook
 *    desktop, image-blocking) still gets the accent colour behind the same
 *    white text, which is why the name carries a dark text shadow.
 *  - **Without one** — the original coloured band: medallion, name, stars
 *    on the accent colour.
 *
 * Colours default to the deep-red / cream / gold identity the apps carry;
 * a venue with its own `primaryColor` gets its band in that colour.
 */

export const EMAIL = {
  accent: "#8f1a1a",
  accentDark: "#701414",
  gold: "#e8c15c",
  cream: "#fdf4e0",
  card: "#ffffff",
  ink: "#360a0a",
  inkSoft: "#7a5d5d",
  line: "#e1d3c2",
  positive: "#397e4c",
  positiveBg: "#e9f3e4",
  warnBg: "#fdeee6",
} as const;

const FONT = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface Brand {
  name: string;
  /** Absolute URL of a square logo, or null for a text-only header. */
  logoUrl: string | null;
  /** Absolute URL of a wide banner photo, or null for a coloured band. */
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
 *  icon from /public/brand, which is the restaurant's in a white-label build. */
export function platformBrand(name: string): Brand {
  return { name, logoUrl: `${siteUrl()}/brand/icon-192.png`, bannerUrl: null, accent: null };
}

/**
 * Logo medallion + venue name + the gold stars, the one identity block
 * both header shapes use. `onPhoto` switches the name to white-on-shadow
 * so it stays readable over an arbitrary banner photo.
 */
function BrandIdentity({ brand, onPhoto }: { brand: Brand; onPhoto: boolean }): React.ReactElement {
  return (
    <>
      {brand.logoUrl ? (
        <img
          src={brand.logoUrl}
          width={84}
          height={84}
          alt={brand.name}
          style={{
            display: "block",
            margin: "0 auto 12px",
            width: 84,
            height: 84,
            borderRadius: 42,
            backgroundColor: EMAIL.card,
            border: `3px solid ${EMAIL.gold}`,
            objectFit: "cover",
          }}
        />
      ) : null}
      <div
        style={{
          color: onPhoto ? "#ffffff" : "#fdf3dd",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "0.02em",
          fontFamily: FONT,
          ...(onPhoto ? { textShadow: "0 1px 6px rgba(0,0,0,0.8)" } : {}),
        }}
      >
        {brand.name}
      </div>
      <div
        style={{
          marginTop: 6,
          color: EMAIL.gold,
          fontSize: 11,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          fontFamily: SANS,
          ...(onPhoto ? { textShadow: "0 1px 6px rgba(0,0,0,0.8)" } : {}),
        }}
      >
        ✦ ✦ ✦
      </div>
    </>
  );
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
  const accent = brand.accent && /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : EMAIL.accent;
  return (
    <html lang={lang} dir={dir}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <meta name="color-scheme" content="light" />
        <title>{title}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: EMAIL.cream, fontFamily: FONT }}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>{title}</div>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: EMAIL.cream }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ width: "100%", maxWidth: 600 }}
                >
                  <tbody>
                    {/* Header: the banner photo AS the background with the
                        identity centred on it, or — with no banner — the
                        coloured band. Never both. */}
                    <tr>
                      {brand.bannerUrl ? (
                        <td
                          // `background` for the clients that only read the
                          // attribute, `background-image` for the ones that
                          // only read CSS; `backgroundColor` is the fallback
                          // when neither survives (Outlook desktop).
                          {...{ background: brand.bannerUrl }}
                          height={220}
                          style={{
                            borderRadius: "16px 16px 0 0",
                            backgroundColor: accent,
                            backgroundImage: `url(${brand.bannerUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            backgroundRepeat: "no-repeat",
                            // Fixed, not min-height: `min-height` is dropped
                            // by too many clients to be the thing holding
                            // the photo open.
                            height: 220,
                          }}
                        >
                          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
                            <tbody>
                              <tr>
                                <td
                                  align="center"
                                  valign="middle"
                                  style={{ padding: "26px 24px", height: 220 }}
                                >
                                  <BrandIdentity brand={brand} onPhoto />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      ) : (
                        <td
                          style={{
                            borderRadius: "16px 16px 0 0",
                            overflow: "hidden",
                            backgroundColor: accent,
                          }}
                        >
                          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
                            <tbody>
                              <tr>
                                <td align="center" style={{ padding: "30px 24px 26px" }}>
                                  <BrandIdentity brand={brand} onPhoto={false} />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      )}
                    </tr>
                    {/* Card */}
                    <tr>
                      <td
                        style={{
                          backgroundColor: EMAIL.card,
                          padding: "28px 28px 24px",
                          borderRadius: "0 0 16px 16px",
                          color: EMAIL.ink,
                          fontSize: 15,
                          lineHeight: 1.55,
                          fontFamily: FONT,
                        }}
                      >
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td
                        align="center"
                        style={{
                          padding: "18px 12px 0",
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
    color: EMAIL.ink,
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
                color: solid ? "#fdf3dd" : EMAIL.accent,
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
