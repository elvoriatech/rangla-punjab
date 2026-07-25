import { asTenant, asUser } from "./tenant";
import { siteUrl } from "./site-url";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * CDN purge-on-write — the piece that makes "owner changes it, guests
 * see it" true behind an edge cache. Called after every write that
 * changes what a guest sees (publish, appearance, settings, admin
 * suspend/plan levers).
 *
 * Config: CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN (purge-scoped).
 * Unset (dev, self-hosted without CDN) → logged no-op. Purge failures
 * are logged, never thrown: a saved menu with a briefly-stale edge
 * copy beats a failed save, and the 5-minute s-maxage in next.config
 * bounds staleness even when a purge is missed.
 *
 * Non-enterprise Cloudflare purges by exact URL, so query-string
 * variants (?diet=…) ride the short TTL instead — that's the deal.
 */

export function buildMenuPurgeUrls(enabledLocales: string[]): string[] {
  const base = siteUrl();
  return [
    `${base}/`,
    ...enabledLocales.map((locale) => `${base}/${encodeURIComponent(locale)}`),
    `${base}/manifest.webmanifest`,
  ];
}

export type PurgeOutcome = "purged" | "skipped_unconfigured" | "failed";

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export async function purgeUrls(
  urls: string[],
  fetchImpl: FetchLike = fetch,
): Promise<PurgeOutcome> {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zone || !token) {
    log.info("cdn.purge_skipped", { reason: "unconfigured", urls: urls.length });
    return "skipped_unconfigured";
  }
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: urls }),
    });
    if (!res.ok) {
      log.warn("cdn.purge_failed", { status: res.status, urls: urls.length });
      return "failed";
    }
    log.info("cdn.purged", { urls: urls.length });
    return "purged";
  } catch (err) {
    log.warn("cdn.purge_failed", {
      error: err instanceof Error ? err.message : "unknown",
      urls: urls.length,
    });
    return "failed";
  }
}

/** Purge the session user's venue menu (owner dashboard actions). */
export async function purgeMenuForUser(userId: string): Promise<PurgeOutcome> {
  const venue = await asUser(userId, (tx) =>
    tx.venue.findFirst({
      where: { deletedAt: null },
      select: { slug: true, enabledLocales: true },
    }),
  );
  if (!venue) return "skipped_unconfigured";
  return purgeUrls(buildMenuPurgeUrls(venue.enabledLocales));
}

/** Purge a tenant's venue menu (platform-admin levers). */
export async function purgeMenuForTenant(tenantId: string): Promise<PurgeOutcome> {
  const venue = await asTenant(tenantId, (tx) =>
    tx.venue.findFirst({
      where: { deletedAt: null },
      select: { slug: true, enabledLocales: true },
    }),
  );
  if (!venue) return "skipped_unconfigured";
  return purgeUrls(buildMenuPurgeUrls(venue.enabledLocales));
}
