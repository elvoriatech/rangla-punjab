import { Prisma } from "@prisma/client";
import { env } from "./env";
import { createLogger } from "./logger";
import { captureException } from "./observability";
import { asTenant, asTenantRead } from "./tenant";

const log = createLogger();

/**
 * "★ 4.6 (312) · Write a review" — the venue's Google rating under its
 * name, on the web menu and in the app (P7-14).
 *
 * Two things are true at once here and they shape the whole file:
 *
 * 1. The number is BORROWED. Google owns it, we cache it, and the cache
 *    is allowed to be a day stale. Nothing the guest can do makes the
 *    number more current, so nothing the guest does should ever wait on
 *    a Google request: the page renders the cached JSON and, when that
 *    is older than a day, a refresh is kicked off behind the response.
 *    That is why there is no BullMQ cron — a menu page is loaded dozens
 *    of times a day, so request-driven revalidation is both simpler and
 *    more current than a nightly job (P7-14 decision).
 *
 * 2. The key is BILLABLE and human-gated. `GOOGLE_PLACES_API_KEY` is
 *    absent in dev, in CI, and in a deployment nobody has configured
 *    yet — so the default provider is an in-memory fake that never calls
 *    Google. An un-keyed deployment shows no rating at all, which is the
 *    honest outcome; it never shows a stale-forever or invented one.
 *
 * Nothing in here throws at a caller. A rating is decoration on top of a
 * menu that must render regardless, and a Places outage turning a QR scan
 * into a 500 would be an absurd trade.
 */

/** What Google answers, trimmed to the two fields we ask for. */
export interface PlaceRating {
  /** Google's average, 1–5. */
  rating: number;
  /** How many user ratings it averages. */
  count: number;
}

/** What `venues.google_rating` holds — a `PlaceRating` plus the instant it
 *  was read, which is the only input to the staleness test. */
export interface CachedRating extends PlaceRating {
  /** ISO 8601, in UTC. */
  fetchedAt: string;
}

/** What the public surfaces render. `reviewUrl` is derived, never stored:
 *  it is a pure function of the Place ID, so a changed URL format is a
 *  code change and not a data migration. */
export interface PublicRating {
  value: number;
  count: number;
  reviewUrl: string;
}

/** The venue columns this module reads. Callers that already hold the row
 *  (the public menu loader does) pass it instead of paying for a second
 *  query. */
export interface VenueRatingRow {
  googlePlaceId: string | null;
  googleRating: unknown;
}

export interface RatingProvider {
  readonly mode: "real" | "fake";
  /** Never throws: an outage, a 403 over billing, or a body we don't
   *  recognise all come back as `null`, which means "no fresher number
   *  today" — the cached one stays exactly as it was. */
  fetch(placeId: string): Promise<PlaceRating | null>;
}

/** Refresh at most once a day per venue. */
export const RATING_TTL_MS = 24 * 60 * 60 * 1000;

const PLACES_BASE = "https://places.googleapis.com/v1/places";

/**
 * Places API (New). One GET per venue per day, with a field mask narrow
 * enough to stay in the cheapest SKU: asking for `rating,userRatingCount`
 * and nothing else is the difference between the Essentials tier and a
 * full place read.
 */
export class GooglePlacesProvider implements RatingProvider {
  readonly mode = "real" as const;

  constructor(private readonly apiKey: string) {}

  async fetch(placeId: string): Promise<PlaceRating | null> {
    try {
      const url = `${PLACES_BASE}/${encodeURIComponent(placeId)}?fields=rating,userRatingCount`;
      const res = await fetch(url, {
        headers: { "X-Goog-Api-Key": this.apiKey, accept: "application/json" },
        // Our own cache is the venue row; an HTTP cache in front of it
        // would only make "when was this read?" a lie.
        cache: "no-store",
      });
      if (!res.ok) {
        log.warn("google_rating.http_error", { status: res.status });
        return null;
      }
      const json = (await res.json()) as { rating?: unknown; userRatingCount?: unknown };
      return parsePlaceRating(json.rating, json.userRatingCount);
    } catch (err) {
      captureException(err, { where: "google-rating", placeId });
      return null;
    }
  }
}

/**
 * The default everywhere the key is absent. Answers whatever a test put in
 * `next` (nothing, by default) and records every Place ID it was asked
 * about, so a test can prove the cache DIDN'T call out as easily as it can
 * prove it did.
 */
export class FakeRatingProvider implements RatingProvider {
  readonly mode = "fake" as const;
  /** Every Place ID handed to `fetch`, oldest first. */
  readonly calls: string[] = [];
  /** What the next fetch answers. Null (the default) = "Google had
   *  nothing for us", which is also what an un-keyed deployment means. */
  next: PlaceRating | null = null;

  async fetch(placeId: string): Promise<PlaceRating | null> {
    this.calls.push(placeId);
    return this.next;
  }

  reset(): void {
    this.calls.length = 0;
    this.next = null;
  }
}

// Cached on globalThis so HMR and repeated imports share one recorder —
// otherwise a test would assert against a different fake than the loader
// used. Same shape as `push-service.ts`.
const globalForRating = globalThis as unknown as {
  ratingProvider?: RatingProvider;
  ratingFake?: FakeRatingProvider;
  ratingInFlight?: Set<string>;
};

/** The fake, for tests and for a dev who wants to see the lookups.
 *  Always the same instance the selector hands out when no key is set. */
export function __fakeRating(): FakeRatingProvider {
  globalForRating.ratingFake ??= new FakeRatingProvider();
  return globalForRating.ratingFake;
}

/** Real transport only when a key exists. */
export function getRatingProvider(): RatingProvider {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) return __fakeRating();
  globalForRating.ratingProvider ??= new GooglePlacesProvider(key);
  return globalForRating.ratingProvider;
}

/**
 * One Places read. Exported for the seam's own tests and for any future
 * caller (an onboarding "check this Place ID" button, say); the menu path
 * goes through {@link refreshVenueRating}, which also writes the cache.
 */
export async function fetchPlaceRating(placeId: string): Promise<PlaceRating | null> {
  if (!placeId) return null;
  return getRatingProvider().fetch(placeId);
}

/**
 * Google's own review form for a place. Pure, and deliberately the
 * `search.google.com` form rather than a Maps deep link: it opens the
 * "write a review" dialog directly, on desktop and mobile web alike, and
 * needs no app installed.
 */
export function reviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/**
 * Read a cached rating out of whatever JSONB holds. Strict on purpose —
 * the same strictness the app applies on its side: a rating outside 1–5, a
 * negative count, or a missing timestamp is not a rating, it's a bug, and
 * "★ NaN" under a restaurant's name is worse than no line at all.
 */
export function parseCachedRating(raw: unknown): CachedRating | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const base = parsePlaceRating(r.rating, r.count);
  if (!base) return null;
  const fetchedAt = typeof r.fetchedAt === "string" ? r.fetchedAt : null;
  if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) return null;
  return { ...base, fetchedAt };
}

function parsePlaceRating(rating: unknown, count: unknown): PlaceRating | null {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  if (rating < 1 || rating > 5) return null;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  return { rating, count: Math.trunc(count) };
}

/**
 * The rating a public surface renders, from a venue row already in hand.
 * Null whenever anything is missing — no Place ID, no cache, or a cache
 * that doesn't parse. Note it does NOT consult the API key: a number
 * already read stays on screen if the key is later rotated out, it just
 * stops being refreshed. Hiding it would be a worse lie than showing
 * yesterday's average.
 */
export function publicRating(row: VenueRatingRow): PublicRating | null {
  if (!row.googlePlaceId) return null;
  const cached = parseCachedRating(row.googleRating);
  if (!cached) return null;
  return { value: cached.rating, count: cached.count, reviewUrl: reviewUrl(row.googlePlaceId) };
}

/** Older than the TTL, or never read at all. */
export function isRatingStale(cached: CachedRating | null, now: Date = new Date()): boolean {
  if (!cached) return true;
  return now.getTime() - Date.parse(cached.fetchedAt) >= RATING_TTL_MS;
}

/**
 * Ask Google and write the answer to the venue. Returns what it stored, or
 * null when it stored nothing — a failed lookup deliberately leaves the
 * previous cache (and its `fetchedAt`) alone, so the next request retries
 * rather than a bad day emptying the line.
 *
 * Never throws.
 */
export async function refreshVenueRating(
  tenantId: string,
  venueId: string,
  placeId: string,
): Promise<CachedRating | null> {
  try {
    const fresh = await fetchPlaceRating(placeId);
    if (!fresh) return null;
    const cached: CachedRating = { ...fresh, fetchedAt: new Date().toISOString() };
    await asTenant(tenantId, (tx) =>
      tx.venue.updateMany({
        // Guarded on the Place ID: if the owner changed it while the
        // request was in flight, this answer is about the old place and
        // must not land.
        where: { id: venueId, googlePlaceId: placeId },
        // Prisma types JSONB writes as its own input union; the cache is a
        // plain object, so the cast is the whole ceremony.
        data: { googleRating: cached as unknown as Prisma.InputJsonObject },
      }),
    );
    log.info("google_rating.refreshed", { tenantId, venueId, count: cached.count });
    return cached;
  } catch (err) {
    captureException(err, { tenantId, venueId, where: "google-rating" });
    return null;
  }
}

/**
 * Stale-while-revalidate, the scheduling half: return immediately, refresh
 * behind the response.
 *
 * Skipped entirely without an API key or without a Place ID — the two
 * human-gated halves of this feature — so an unconfigured deployment never
 * makes a single request.
 *
 * The refresh is deferred with `setTimeout(…, 0)` rather than started
 * inline: the one caller on the hot path runs inside the public menu's
 * read transaction, and the refresh WRITES on the primary. Deferring to
 * the next macrotask means that write always opens after the read
 * transaction has committed instead of competing with it for the pool.
 * The timer is unref'd so it can never hold a process open.
 */
export function scheduleVenueRatingRefresh(
  tenantId: string,
  venueId: string,
  row: VenueRatingRow,
  now: Date = new Date(),
): boolean {
  const placeId = row.googlePlaceId;
  if (!placeId || !env.GOOGLE_PLACES_API_KEY) return false;
  if (!isRatingStale(parseCachedRating(row.googleRating), now)) return false;
  // One in-flight refresh per venue. Without this, a burst of cold-cache
  // requests (exactly what a QR code at a busy table produces) would each
  // start their own Places call for the same place.
  const inFlight = (globalForRating.ratingInFlight ??= new Set<string>());
  if (inFlight.has(venueId)) return false;
  inFlight.add(venueId);
  const timer = setTimeout(() => {
    void refreshVenueRating(tenantId, venueId, placeId).finally(() => inFlight.delete(venueId));
  }, 0);
  (timer as { unref?: () => void }).unref?.();
  return true;
}

/**
 * The cached rating for one venue, refreshing behind the response when it
 * is older than a day. This is the general entry point; the public menu
 * loader uses {@link publicRating} + {@link scheduleVenueRatingRefresh}
 * directly on the venue row it has already read, so a menu render costs no
 * extra query.
 *
 * Never throws — a database hiccup here returns null, and the surface
 * above simply renders no rating line.
 */
export async function getVenueRating(
  tenantId: string,
  venueId: string,
): Promise<PublicRating | null> {
  try {
    const row = await asTenantRead(tenantId, (tx) =>
      tx.venue.findFirst({
        where: { id: venueId, deletedAt: null },
        select: { googlePlaceId: true, googleRating: true },
      }),
    );
    if (!row) return null;
    scheduleVenueRatingRefresh(tenantId, venueId, row);
    return publicRating(row);
  } catch (err) {
    captureException(err, { tenantId, venueId, where: "google-rating" });
    return null;
  }
}
