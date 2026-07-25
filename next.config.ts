import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const withMDX = createMDX({
  // Options intentionally minimal — we author placeholder legal copy for
  // now; real remark/rehype plugin chain (citations, footnotes) lands
  // with P1-22c when counsel-authored copy replaces the placeholders.
});

const nextConfig: NextConfig = {
  output: "standalone",
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
        // Public menu is static-first and edge-cached (roadmap §3). The
        // menu now lives at the domain root: `/` (default locale) and
        // `/{locale}`. The optional locale param — constrained to the
        // BCP-47 codes we support — keeps this rule off /dashboard,
        // /admin, /login, etc.
        // 5-minute freshness + purge-on-write (src/lib/cdn-purge.ts):
        // the purge makes changes instant; the short TTL bounds
        // staleness for anything a URL-list purge can't reach
        // (query-string variants on non-enterprise Cloudflare).
        source: "/:locale(en|de|fr|it|es|nl|pl|pt|tr|ar)?",
        // P1-9: never cache preview responses — every dashboard user's phone-
        // preview URL is a fresh signed token, and a cached preview would
        // outlive the token's TTL.
        missing: [{ type: "query", key: "preview" }],
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400",
          },
        ],
      },
      {
        // Explicit no-store for the preview path so Cloudflare/browsers do
        // not hold a copy after the token expires.
        source: "/:locale(en|de|fr|it|es|nl|pl|pt|tr|ar)?",
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
