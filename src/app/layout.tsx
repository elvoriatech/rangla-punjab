import type { Metadata } from "next";
import { Geist, Cormorant_Garamond } from "next/font/google";
import { headers } from "next/headers";
import { publicMenuDefaultLocale } from "@/lib/public-menu-lang";
import { dirFor, isLocaleCode } from "@/lib/locales";
import { getRestaurantSlug } from "@/lib/restaurant";
import { getOperatorSettings } from "@/lib/operator-settings";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Serif display face for headlines. 400 for body-serif, 500/600 for the
// upright display headings the Guesto theme uses.
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: `${BRAND.name} — Order Online`,
  description: BRAND.tagline,
  // The restaurant app icon as the favicon on EVERY page — declared via metadata (not
  // the app/favicon.ico file convention) so the guest menu can swap in an
  // uploaded restaurant logo without the file-convention icon competing.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/rangla-icon-180.png", sizes: "180x180", type: "image/png" },
    ],
    apple: [{ url: "/rangla-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  // Site web-app manifest (served dynamically from the restaurant's
  // branding at /menu.webmanifest — /manifest.webmanifest is reserved by
  // Next's metadata convention, so we use a plain route instead).
  manifest: "/menu.webmanifest",
  appleWebApp: {
    capable: true,
    title: BRAND.name,
    statusBarStyle: "black-translucent",
  },
};

/**
 * Derives the html lang from the pathname the middleware injected.
 * The locale route `/{locale}` uses the explicit locale; the locale-less
 * menu at `/` uses the venue's default language (a German menu tagged
 * lang="en" triggers Chrome auto-translate, which rewrites the DOM and
 * breaks hydration). Every other route (/dashboard, /admin, …) stays
 * English — we don't tell a browser "this dashboard is German" when it isn't.
 */
async function resolveHtmlLang(): Promise<string> {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const seg = pathname.match(/^\/([^/?]+)/)?.[1];
  if (seg && isLocaleCode(seg)) {
    return seg;
  }
  // Root menu ("/") → the restaurant's default language.
  if (pathname === "/" || pathname === "") {
    try {
      const venueDefault = await publicMenuDefaultLocale(await getRestaurantSlug());
      if (venueDefault && isLocaleCode(venueDefault)) {
        return venueDefault;
      }
    } catch {
      // A lang hint must never 500 the whole document.
    }
  }
  return "en";
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await resolveHtmlLang();
  // App theme drives `data-theme` on <html>, but ONLY for the operator/owner
  // chrome (dashboard, admin, auth) — the public menu is zero-cookie and
  // edge-cached, so it must not take a DB hit here and keeps its own
  // per-venue MENU_THEMES look.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isChrome = /^\/(dashboard|admin|login|reset|verify|kitchen)(\/|$)/.test(pathname);
  const appTheme = isChrome ? (await getOperatorSettings()).appTheme : "default";
  return (
    // suppressHydrationWarning: <html lang> legitimately varies by route
    // (venue locale on /r/{slug}, "en" elsewhere), but the client router
    // keeps ONE <html> instance across soft navigations, so its cached
    // lang can differ from a fresh server document. React keeps the
    // correct server value; this silences the unavoidable attribute diff
    // on this one element only (same pattern next-themes uses).
    //
    // `dir` rides along with `lang`: it is the whole of RTL support on
    // the web side, and it must be an attribute on <html> (not a class)
    // so the browser mirrors scrollbars, text selection and the logical
    // Tailwind utilities (ms-/me-/ps-/pe-/start-/end-) the guest
    // surfaces use.
    <html
      suppressHydrationWarning
      lang={lang}
      dir={dirFor(lang)}
      data-theme={appTheme !== "default" ? appTheme : undefined}
      className={`${geistSans.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
