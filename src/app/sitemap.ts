import type { MetadataRoute } from "next";
import { listPublicVenues, siteUrl } from "@/lib/public-menu";

/**
 * Sitemap for crawlers. One entry per published venue × enabled locale,
 * plus the marketing root. Unpublished or soft-deleted venues are
 * excluded by the SECURITY DEFINER filter in `list_public_venues()` —
 * never leak a work-in-progress restaurant name via the sitemap.
 */
/**
 * Next treats `sitemap.ts` as a Route Handler that is CACHED by default,
 * which means it is executed during `next build` — and this one queries
 * the database for published venues. That is fine locally, where the dev
 * database happens to be reachable, but inside `docker build` there is
 * no database and the build died on a TCP connect. (`.dockerignore`
 * correctly keeps .env out of the image, so there were no credentials
 * either.) The production image was therefore unbuildable.
 *
 * Opting out of the cache is also the behaviour we want: the sitemap
 * should list what is published right now, not whatever was published
 * when the image was built.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const venues = await listPublicVenues();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "monthly", priority: 0.5 },
  ];
  for (const v of venues) {
    for (const locale of v.enabledLocales) {
      entries.push({
        url: `${base}/${locale}`,
        lastModified: v.updatedAt,
        changeFrequency: "weekly",
        priority: 0.8,
        alternates: {
          languages: Object.fromEntries(v.enabledLocales.map((l) => [l, `${base}/${l}`])),
        },
      });
    }
  }
  return entries;
}
