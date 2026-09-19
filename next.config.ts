import type { NextConfig } from "next";
import createMDX from "@next/mdx";
// The ONE locale registry (src/lib/locales.ts) is dependency-free precisely
// so this config can import it — the cache rule below and `<html lang>`
// must never drift apart.
import { LOCALE_PATH_PATTERN } from "./src/lib/locales";

const withMDX = createMDX({
  // Options intentionally minimal — we author placeholder legal copy for
  // now; real remark/rehype plugin chain (citations, footnotes) lands
  // with P1-22c when counsel-authored copy replaces the placeholders.
});

/**
 * Content-Security-Policy.
 *
 * Deliberately a STATIC policy, not the nonce-per-request one Next's CSP
 * guide shows: a nonce must be minted per request, which forces dynamic
 * rendering, and the guest menu is static-first and edge-cacheable by
 * design (the `s-maxage` rules below). Trading that away for a nonce
 * would cost every guest a server render.
 *
 * What the app actually loads makes a tight policy possible anyway:
 * there are no third-party scripts or SDKs at all (PayPal and Stripe are
 * server-side redirects, not embedded JS), and `next/font/google`
 * self-hosts its fonts under /_next/static at build time — so no
 * external script, font, or style origin is needed.
 *
 * The one loose directive is `'unsafe-inline'` for scripts, which the
 * framework's own hydration bootstrap requires without a nonce. It still
 * blocks the more common vector: a script pulled from an attacker's
 * origin. `'unsafe-eval'` is dev-only — React uses eval there to
 * reconstruct server stacks, and neither React nor Next needs it in
 * production.
 */
const isDev = process.env.NODE_ENV === "development";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind + the per-venue theme variables render as inline <style>.
  "style-src 'self' 'unsafe-inline'",
  // data: for the transparent-pixel placeholder, blob: for client-side
  // QR/receipt rendering.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  // The dashboard previews the menu in a same-origin iframe.
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  // Checkout redirects leave the origin via a 303 (a navigation, not a
  // form post), so 'self' is enough here.
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  // Version-skew protection (self-hosted, one container replaced per
  // deploy): assets carry ?dpl=<id>, client navigations send
  // x-deployment-id, and on a mismatch Next does a full reload instead of
  // a client navigation that would 404 on old chunks or hit a Server
  // Action id the new build no longer has ("This page couldn't load" on
  // every tablet left open across a deploy). GIT_SHA is the image's
  // build-arg (deploy.sh build); undefined in dev keeps HMR untouched.
  deploymentId: process.env.GIT_SHA || undefined,
  experimental: {
    serverActions: {
      // Bulk photo/menu uploads post several files inline (multipart server
      // actions); the per-file cap is 10 MB (upload-service MAX_BYTES), so
      // a batch needs real headroom above that.
      bodySizeLimit: "50mb",
    },
    // Requests pass through src/middleware.ts (the "proxy"), whose client
    // body cap defaults to 10 MB and truncates a larger upload BEFORE the
    // server action sees it ("Unexpected end of form"). Raise it to match
    // the server-action limit so bulk uploads survive the proxy.
    proxyClientMaxBodySize: "50mb",
  },
  // Let `.mdx` files under app/ + src/ act as page/content sources.
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  async headers() {
    return [
      {
        // ---- Security headers ------------------------------------------
        // There is no CDN or WAF in front of this deploy (single VPS,
        // Caddy for TLS only), so the app is the only place these can
        // come from. Applied to every path, including /api, which
        // src/middleware.ts deliberately skips.
        source: "/:path*",
        headers: [
          // 2 years + preload: the origin is HTTPS-only behind Caddy,
          // which redirects :80 itself. Harmless over plain http on
          // localhost — browsers ignore HSTS from a non-secure origin.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The dashboard embeds the live menu preview in an iframe, so
          // this is SAMEORIGIN rather than DENY.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Content-Security-Policy",
            value: CSP,
          },
        ],
      },
      {
        // Public menu is static-first and edge-cached (roadmap §3). The
        // menu now lives at the domain root: `/` (default locale) and
        // `/{locale}`. The optional locale param — constrained to the
        // BCP-47 codes in the locale registry — keeps this rule off
        // /dashboard, /admin, /login, etc.
        // 5-minute freshness + purge-on-write (src/lib/cdn-purge.ts):
        // the purge makes changes instant; the short TTL bounds
        // staleness for anything a URL-list purge can't reach
        // (query-string variants on non-enterprise Cloudflare).
        //
        // The stale window is 10 minutes, not a day, because this HTML
        // carries clock-dependent state: the open/closed badge and
        // whether the cart may still offer "Now". A day-long
        // stale-while-revalidate could hand a guest last night's answer
        // after an edge miss; 300 s fresh + 600 s stale caps the lag at
        // about a quarter hour. `stale-if-error` stays at a day on
        // purpose — that one only applies when the origin is DOWN, and a
        // stale menu beats an error page.
        source: `/:locale(${LOCALE_PATH_PATTERN})?`,
        // P1-9: never cache preview responses — every dashboard user's phone-
        // preview URL is a fresh signed token, and a cached preview would
        // outlive the token's TTL.
        missing: [{ type: "query", key: "preview" }],
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400",
          },
        ],
      },
      {
        // Explicit no-store for the preview path so Cloudflare/browsers do
        // not hold a copy after the token expires.
        source: `/:locale(${LOCALE_PATH_PATTERN})?`,
        has: [{ type: "query", key: "preview" }],
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        // Legal pages are static content served through the CDN. Long TTL
        // with a short SWR so a copy update lands in front of guests
        // within a minute; the content itself rarely changes.
        source: "/legal/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=60, stale-if-error=86400",
          },
        ],
      },
    ];
  },
};

export default withMDX(nextConfig);
