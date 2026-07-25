import type { MetadataRoute } from "next";
import { listPublicVenues, siteUrl } from "@/lib/public-menu";

/**
 * Sitemap for crawlers. One entry per published venue × enabled locale,
 * plus the marketing root. Unpublished or soft-deleted venues are
 * excluded by the SECURITY DEFINER filter in `list_public_venues()` —
 * never leak a work-in-progress restaurant name via the sitemap.
 */
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
