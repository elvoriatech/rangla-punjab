import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/public-menu";

/**
 * robots.txt. The guest menu is the whole point of this deploy, so the
 * public surface is crawlable; everything behind a login, everything
 * token-gated, and every machine endpoint is not.
 *
 * Why the token-gated paths are listed even though a crawler could never
 * guess a receipt token: a guest who shares their receipt link (in a
 * forum post, a WhatsApp web preview, a pasted URL) would otherwise hand
 * a crawler a live order URL. Disallowing the prefix keeps those out of
 * an index even when the link leaks.
 *
 * `/img/` stays allowed — menu photos in image search are free reach.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Staff + operator consoles.
          "/dashboard/",
          "/admin/",
          "/kitchen",
          // Credentialed flows — nothing to index, and indexing a reset
          // link is actively bad.
          "/login",
          "/reset",
          "/verify",
          "/account",
          // Token-gated per-order pages.
          "/pay/",
          "/order-status/",
          "/print/",
          // Machine endpoints.
          "/api/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
