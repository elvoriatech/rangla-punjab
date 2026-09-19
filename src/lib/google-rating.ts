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

/** What `venues.google_rating_manual` holds — the number the owner typed
 *  themselves, plus when they typed it.
 *
 *  Deliberately `updatedAt` rather than `fetchedAt`: those two words mean
 *  different things ("a human last entered this" vs "we last asked
 *  Google"), and only the second one may ever feed the staleness test. A
 *  hand-entered rating never goes stale, because nothing is going to
 *  refresh it. */
export interface ManualRating extends PlaceRating {
  /** ISO 8601, in UTC. */
  updatedAt: string;
}

/** What the public surfaces render. `reviewUrl` is derived, never stored:
 *  it is a pure function of the Place ID, so a changed URL format is a
 *  code change and not a data migration. Null when the rating came from
 *  the owner's own typing and they never saved a Place ID — there is a
 *  number to show but nowhere for "write a review" to go. */
export interface PublicRating {
  value: number;
  count: number;
  reviewUrl: string | null;
}

/** The venue columns this module reads. Callers that already hold the row
 *  (the public menu loader does) pass it instead of paying for a second
 *  query. `googleRatingManual` is optional so a hand-built fixture from
 *  before the fallback existed still type-checks; absent reads as "no
 *  manual rating", same as null. */
export interface VenueRatingRow {
  googlePlaceId: string | null;
  googleRating: unknown;
  googleRatingManual?: unknown;
  /** The owner's switch for the whole line. Optional, and ABSENT MEANS ON
   *  — the column is `NOT NULL DEFAULT true` and every venue that predates
   *  the switch was showing its rating, so a fixture that doesn't mention
   *  it must not accidentally hide one. Only an explicit `false` hides. */
  googleRatingEnabled?: boolean;
}

/**
 * Why a lookup produced no number. The background refresher does not care
 * (any failure means "keep yesterday's number"), but the owner pressing
 * "Search" or "Refresh rating now" in Settings absolutely does: "the key
 * is missing from prod.env" and "Google has never heard of that place"
 * need completely different things done about them, and an owner who is
 * told only "it didn't work" has no way to tell which one they are in.
 */
export type RatingError =
  "no_api_key" | "api_not_enabled" | "key_invalid" | "quota" | "not_found" | "network" | "unknown";

/** One Text Search hit, trimmed to what the owner needs to recognise
 *  their own restaurant in a list of five. */
export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
}

export type PlaceSearchResult =
  { ok: true; places: PlaceSuggestion[] } | { ok: false; error: RatingError };

export type RatingLookupResult =
  { ok: true; rating: PlaceRating } | { ok: false; error: RatingError };

export interface RatingProvider {
  readonly mode: "real" | "fake";
  /** Never throws: an outage, a 403 over billing, or a body we don't
   *  recognise all come back as `null`, which means "no fresher number
   *  today" — the cached one stays exactly as it was. */
  fetch(placeId: string): Promise<PlaceRating | null>;
  /** The same call as {@link fetch}, with the reason kept. Never throws. */
  lookup(placeId: string): Promise<RatingLookupResult>;
  /** Places Text Search — "Rangla Punjab Berlin" in, up to five candidate
   *  Place IDs out. Never throws. */
  searchPlaces(query: string): Promise<PlaceSearchResult>;
}

/** Refresh at most once a day per venue. */
export const RATING_TTL_MS = 24 * 60 * 60 * 1000;

const PLACES_BASE = "https://places.googleapis.com/v1/places";
const SEARCH_URL = `${PLACES_BASE}:searchText`;
/** Google's own ceiling for the picker; also all an owner will read. */
const SEARCH_MAX_RESULTS = 5;
/** A name or address longer than this is a body of text, not a label —
 *  and every character rides back through a redirect URL. */
const SUGGESTION_FIELD_MAX = 160;

/**
 * Turn a Places failure into one of our seven codes.
 *
 * Google says the same thing two ways — an HTTP status and a
 * `error.status` / `error.message` pair — and the pair is by far the more
 * specific of the two: a 403 is "enable the API", "the key is restricted"
 * or "billing lapsed" depending only on the prose. So the message is read
 * first, the gRPC status second, and the bare HTTP code last, as the
 * fallback for a body we couldn't parse at all.
 *
 * The distinction earning its keep here is `api_not_enabled` vs
 * `key_invalid`: both are 403-shaped, and the fix for one (click Enable
 * in the Cloud console) does nothing for the other (paste a different
 * key). Collapsing them would send an owner to the wrong screen.
 */
export function mapPlacesError(status: number, body: unknown): RatingError {
  const err = (body as { error?: { status?: unknown; message?: unknown } } | null)?.error;
  const gStatus = typeof err?.status === "string" ? err.status.toUpperCase() : "";
  const message = typeof err?.message === "string" ? err.message.toLowerCase() : "";

  if (message.includes("api key not valid") || message.includes("api_key_invalid")) {
    return "key_invalid";
  }
  if (
    message.includes("has not been used") ||
    message.includes("is disabled") ||
    message.includes("not enabled")
  ) {
    return "api_not_enabled";
  }
  switch (gStatus) {
    // A PERMISSION_DENIED whose prose didn't name a disabled API is a key
    // problem: wrong key, wrong project, or an application restriction
    // this server can't satisfy.
    case "PERMISSION_DENIED":
    case "UNAUTHENTICATED":
      return "key_invalid";
    case "INVALID_ARGUMENT":
      return "key_invalid";
    case "RESOURCE_EXHAUSTED":
      return "quota";
    case "NOT_FOUND":
      return "not_found";
    default:
      break;
  }
  switch (status) {
    case 400:
    case 401:
    case 403:
      return "key_invalid";
    case 404:
      return "not_found";
    case 429:
      return "quota";
    default:
      return status >= 500 ? "network" : "unknown";
  }
}

/** Google's error envelope, if the body is JSON at all. A 502 from a
 *  proxy in between is HTML, and must not become an exception. */
async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function parseSuggestions(raw: unknown): PlaceSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceSuggestion[] = [];
  for (const entry of raw.slice(0, SEARCH_MAX_RESULTS)) {
    if (!entry || typeof entry !== "object") continue;
    const p = entry as { id?: unknown; displayName?: unknown; formattedAddress?: unknown };
    const id = typeof p.id === "string" ? p.id.trim() : "";
    if (!id || id.length > 255) continue;
    const name =
      p.displayName && typeof p.displayName === "object"
        ? String((p.displayName as { text?: unknown }).text ?? "")
        : "";
    const address = typeof p.formattedAddress === "string" ? p.formattedAddress : "";
    out.push({
      id,
      name: name.slice(0, SUGGESTION_FIELD_MAX),
      address: address.slice(0, SUGGESTION_FIELD_MAX),
    });
  }
  return out;
}

/**
 * Places API (New). One GET per venue per day, with a field mask narrow
 * enough to stay in the cheapest SKU: asking for `rating,userRatingCount`
 * and nothing else is the difference between the Essentials tier and a
 * full place read.
 *
 * Text Search (the owner's "find my Place ID" box) is the one call here
 * that is NOT on any hot path — it happens once, during setup, behind an
 * owner session and a rate limit, so it may be as expensive as it likes.
 */
export class GooglePlacesProvider implements RatingProvider {
  readonly mode = "real" as const;

  constructor(private readonly apiKey: string) {}

  async fetch(placeId: string): Promise<PlaceRating | null> {
    const result = await this.lookup(placeId);
    return result.ok ? result.rating : null;
  }

  async lookup(placeId: string): Promise<RatingLookupResult> {
    try {
      const url = `${PLACES_BASE}/${encodeURIComponent(placeId)}?fields=rating,userRatingCount`;
      const res = await fetch(url, {
        headers: { "X-Goog-Api-Key": this.apiKey, accept: "application/json" },
        // Our own cache is the venue row; an HTTP cache in front of it
        // would only make "when was this read?" a lie.
        cache: "no-store",
      });
      if (!res.ok) {
        const error = mapPlacesError(res.status, await safeJson(res));
        log.warn("google_rating.http_error", { status: res.status, error });
        return { ok: false, error };
      }
      const json = (await res.json()) as { rating?: unknown; userRatingCount?: unknown };
      const rating = parsePlaceRating(json.rating, json.userRatingCount);
      // A real place with no reviews yet answers 200 with no `rating`
      // field at all. There is nothing to show and nothing to retry.
      if (!rating) return { ok: false, error: "not_found" };
      return { ok: true, rating };
    } catch (err) {
      captureException(err, { where: "google-rating", placeId });
      return { ok: false, error: "network" };
    }
  }

  async searchPlaces(query: string): Promise<PlaceSearchResult> {
    try {
      const res = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          // The field mask is mandatory on searchText and also the whole
          // billing story: id + name + address is the Text Search Essentials
          // SKU, and adding one more field silently moves the call up a tier.
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
          "content-type": "application/json",
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: SEARCH_MAX_RESULTS }),
        cache: "no-store",
      });
      if (!res.ok) {
        const error = mapPlacesError(res.status, await safeJson(res));
        log.warn("google_rating.search_http_error", { status: res.status, error });
        return { ok: false, error };
      }
      const json = (await res.json()) as { places?: unknown };
      const places = parseSuggestions(json.places);
      // Google answers 200 with an empty body when nothing matched.
      if (places.length === 0) return { ok: false, error: "not_found" };
      return { ok: true, places };
    } catch (err) {
      captureException(err, { where: "google-rating-search" });
      return { ok: false, error: "network" };
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
  /** Every Place ID handed to `fetch`/`lookup`, oldest first. */
  readonly calls: string[] = [];
  /** Every text query handed to `searchPlaces`, oldest first. */
  readonly searches: string[] = [];
  /** What the next fetch answers. Null (the default) = "Google had
   *  nothing for us", which is also what an un-keyed deployment means. */
  next: PlaceRating | null = null;
  /** What an unstaged lookup fails with. `no_api_key` by default,
   *  because the fake IS the un-keyed deployment: an owner who presses
   *  "Refresh rating now" on a box with no key gets told exactly that. */
  nextError: RatingError = "no_api_key";
  /** What the next search answers, when staged. */
  nextSearch: PlaceSuggestion[] | null = null;
  /** Force a specific search failure, staged or not. */
  nextSearchError: RatingError | null = null;

  async fetch(placeId: string): Promise<PlaceRating | null> {
    const result = await this.lookup(placeId);
    return result.ok ? result.rating : null;
  }

  async lookup(placeId: string): Promise<RatingLookupResult> {
    this.calls.push(placeId);
    if (this.next) return { ok: true, rating: this.next };
    return { ok: false, error: this.nextError };
  }

  async searchPlaces(query: string): Promise<PlaceSearchResult> {
    this.searches.push(query);
    if (this.nextSearchError) return { ok: false, error: this.nextSearchError };
    if (this.nextSearch && this.nextSearch.length > 0) {
      return { ok: true, places: this.nextSearch.slice(0, SEARCH_MAX_RESULTS) };
    }
    return { ok: false, error: this.nextError };
  }

  reset(): void {
    this.calls.length = 0;
    this.searches.length = 0;
    this.next = null;
    this.nextError = "no_api_key";
    this.nextSearch = null;
    this.nextSearchError = null;
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

/** How much text we will hand Google. A restaurant name plus a city is
 *  well under this; anything longer is a paste accident. */
const SEARCH_QUERY_MAX = 200;

/**
 * "Rangla Punjab, Berlin" → up to five Place IDs the owner can recognise.
 *
 * The seam's own entry point for the Settings picker. Never throws, and
 * never calls out on an empty query — an owner who submits a blank box
 * should not spend a billable request to be told nothing matched.
 */
export async function searchPlaces(query: string): Promise<PlaceSearchResult> {
  const q = query.trim().slice(0, SEARCH_QUERY_MAX);
  if (!q) return { ok: false, error: "not_found" };
  return getRatingProvider().searchPlaces(q);
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
 * "Find this restaurant on Google Maps" — the fallback destination for a
 * venue that has a rating but no Place ID (the owner typed the number
 * themselves and never ran the Place ID search).
 *
 * It exists for the MOBILE app specifically. The web menu simply renders
 * no link in that case, but the app's `asRating()` treats a `reviewUrl`
 * that is not an http(s) URL as "there is no rating here" and hides the
 * whole line — so sending it `null` would throw away the number the owner
 * just typed. A Maps search for the venue's name is a real, openable URL
 * that lands the guest on the right place page in one tap, which is close
 * enough to the review form to be worth far more than a hidden line.
 */
export function mapsSearchUrl(venueName: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueName.trim())}`;
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

/** Nobody has ten million Google reviews; a number past this is a paste
 *  accident or a zero held down, and "★ 4.7 (999999999)" under a
 *  restaurant's name reads as a broken page. */
export const MANUAL_COUNT_MAX = 10_000_000;

/**
 * The numeric gate for a hand-entered rating, used in both directions: on
 * the way in from the Settings form, and on the way back out of the
 * column. One function so a value that was storable can never become
 * unreadable (or vice versa) by the two rules drifting apart.
 *
 * Stricter than {@link parsePlaceRating} on purpose. Google itself only
 * ever publishes a rating to one decimal, so "4.65" is not a number the
 * owner is copying off their Business profile — it is a typo, and
 * rounding it silently would put a figure on the menu nobody chose.
 */
export function normaliseManualRating(rating: unknown, count: unknown): PlaceRating | null {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  if (rating < 1 || rating > 5) return null;
  // `4.7 * 10` is 46.99999999999999 in binary floating point, so the
  // integrality test has to be on the rounded value with a tolerance,
  // never on `rating * 10 % 1`.
  const tenths = Math.round(rating * 10);
  if (Math.abs(rating * 10 - tenths) > 1e-6) return null;
  if (typeof count !== "number" || !Number.isInteger(count)) return null;
  if (count < 0 || count > MANUAL_COUNT_MAX) return null;
  return { rating: tenths / 10, count };
}

/** Read an owner-typed rating out of `venues.google_rating_manual`. Same
 *  strictness as {@link parseCachedRating}: anything that isn't a whole
 *  well-formed value reads as no value at all. */
export function parseManualRating(raw: unknown): ManualRating | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const base = normaliseManualRating(r.rating, r.count);
  if (!base) return null;
  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : null;
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) return null;
  return { ...base, updatedAt };
}

/**
 * The two Settings inputs — both raw strings — turned into a storable
 * rating, or null when either is not what it claims to be.
 *
 * A comma decimal is accepted because half this app's owners type on a
 * German keyboard and "4,7" is what their own Google profile shows them;
 * refusing it would be refusing the correct answer. The review count is
 * digits only: "1,204" is ambiguous across the very locales we just
 * accommodated (one thousand two hundred, or one point two?), so the
 * field asks for a plain integer and means it.
 */
export function parseManualRatingInput(rating: string, count: string): PlaceRating | null {
  const r = rating.trim().replace(",", ".");
  const c = count.trim().replace(/\s/g, "");
  if (!/^\d+(\.\d+)?$/.test(r) || !/^\d+$/.test(c)) return null;
  return normaliseManualRating(Number(r), Number(c));
}

/**
 * The rating a public surface renders, from a venue row already in hand.
 *
 * Precedence, in one place so every surface agrees:
 *
 * 0. The owner's on/off switch. Off ⇒ nothing, whatever is stored.
 * 1. The FETCHED cache, whenever a Place ID and a parsable cache are both
 *    there. It is Google's own current answer, so it outranks anything a
 *    human typed — including a human who typed something else yesterday.
 *    An owner who starts with a hand-entered number and later gets the
 *    API key configured watches the live number take over by itself.
 *    (The cache is gated on the Place ID because without one it is
 *    orphaned: it was read for a place the owner has since cleared.)
 * 2. The MANUAL value — the number the owner read off their own Google
 *    Business profile and typed into Settings. It needs no Place ID and
 *    no API key, which is the entire point of it.
 * 3. Nothing at all.
 *
 * Note it does NOT consult the API key: a number already read stays on
 * screen if the key is later rotated out, it just stops being refreshed.
 * Hiding it would be a worse lie than showing yesterday's average.
 */
export function publicRating(row: VenueRatingRow): PublicRating | null {
  // The owner's switch comes first, before either source is even read: it
  // means "show no rating line", not "forget the numbers". Both columns
  // keep their values, so switching it back on needs no retyping — which
  // is the whole reason it is a column of its own and not a delete.
  if (row.googleRatingEnabled === false) return null;
  const link = row.googlePlaceId ? reviewUrl(row.googlePlaceId) : null;
  const cached = row.googlePlaceId ? parseCachedRating(row.googleRating) : null;
  if (cached) return { value: cached.rating, count: cached.count, reviewUrl: link };
  const manual = parseManualRating(row.googleRatingManual);
  if (manual) return { value: manual.rating, count: manual.count, reviewUrl: link };
  return null;
}

/** What a "rate us on Google" call-to-action needs: somewhere to send the
 *  guest, and — when we happen to know it — the number to show next to the
 *  ask. The URL is always the WRITE-REVIEW form, never a Maps search. */
export interface ReviewLink {
  reviewUrl: string;
  /** The rating we'd render elsewhere, when there is one. Absent for a
   *  venue that has a Place ID but no number yet (no manual value, no
   *  successful fetch) — which is exactly the venue that most wants the
   *  guest to write the first review. */
  ratingValue?: number;
}

/**
 * The post-order "How was it? Rate us on Google" ask, from a venue row
 * already in hand.
 *
 * Same precedence as {@link publicRating} — the owner's switch is read
 * first, and the number (when shown) is the fetched cache before the
 * manual value — with one deliberate difference: NO PLACE ID MEANS NO
 * CALL-TO-ACTION. The Maps-search fallback that {@link mapsSearchUrl}
 * exists for is right for a rating LINE ("here is the place we're quoting")
 * and wrong for this one: asking a guest to rate us and then dropping them
 * on a search results page is a broken promise, not a soft landing.
 */
export function reviewCallToAction(row: VenueRatingRow): ReviewLink | null {
  if (row.googleRatingEnabled === false) return null;
  if (!row.googlePlaceId) return null;
  const rating = publicRating(row);
  const link: ReviewLink = { reviewUrl: reviewUrl(row.googlePlaceId) };
  if (rating) link.ratingValue = rating.value;
  return link;
}

/**
 * {@link reviewCallToAction} for a caller that holds only ids — the
 * receipt mailer, which loads its order long before it knows whether the
 * venue has a Place ID at all.
 *
 * Never throws: a review link is an extra on top of a receipt that must
 * go out regardless, so a database hiccup here means "no button", not
 * "no email".
 */
export async function venueReviewLink(
  tenantId: string,
  venueId: string,
): Promise<ReviewLink | null> {
  try {
    const row = await asTenantRead(tenantId, (tx) =>
      tx.venue.findFirst({
        where: { id: venueId, deletedAt: null },
        select: {
          googlePlaceId: true,
          googleRating: true,
          googleRatingManual: true,
          googleRatingEnabled: true,
        },
      }),
    );
    return row ? reviewCallToAction(row) : null;
  } catch (err) {
    captureException(err, { tenantId, venueId, where: "google-rating-review-link" });
    return null;
  }
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
  const result = await refreshVenueRatingNow(tenantId, venueId, placeId);
  return result.ok ? result.cached : null;
}

export type RatingRefreshResult =
  { ok: true; cached: CachedRating } | { ok: false; error: RatingError };

/**
 * {@link refreshVenueRating} with the failure reason kept, for the owner
 * pressing "Refresh rating now" in Settings. Same write, same guard, same
 * "a bad day at Google never empties the cache" promise — the only
 * difference is that the caller learns WHY nothing was written.
 *
 * Never throws.
 */
export async function refreshVenueRatingNow(
  tenantId: string,
  venueId: string,
  placeId: string,
): Promise<RatingRefreshResult> {
  try {
    if (!placeId) return { ok: false, error: "not_found" };
    const lookup = await getRatingProvider().lookup(placeId);
    if (!lookup.ok) return lookup;
    const cached: CachedRating = { ...lookup.rating, fetchedAt: new Date().toISOString() };
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
    return { ok: true, cached };
  } catch (err) {
    captureException(err, { tenantId, venueId, where: "google-rating" });
    return { ok: false, error: "unknown" };
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
  // Switched off ⇒ nobody is looking at the number, so nobody should be
  // paying Google to keep it current. It resumes refreshing the moment
  // the owner switches the line back on.
  if (row.googleRatingEnabled === false) return false;
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
        select: {
          googlePlaceId: true,
          googleRating: true,
          googleRatingManual: true,
          googleRatingEnabled: true,
        },
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
