import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "./client-ip";
import { withCors } from "./cors";
import { env } from "./env";
import { mapsSearchUrl, publicRating, type VenueRatingRow } from "./google-rating";
import { checkRateLimit, GOOGLE_LOOKUP_IP } from "./rate-limit";
import { STAFF_NO_STORE } from "./staff-request";
import { getVenueForUser, getVenueGoogle, type VenueRatingRefreshError } from "./venue-service";

/**
 * The Google-rating card as the APP reads it (P7-14, owner half).
 *
 * One builder for all four `/api/v1/staff/rating*` routes, because every
 * one of them answers with the WHOLE card: a PATCH that only flips the
 * switch still returns the numbers, the link and `canFetch`, so the screen
 * never has to stitch a response onto stale local state and never draws a
 * half-updated card.
 *
 * Everything here is derived from the same two functions the web settings
 * page and the guest menu use (`getVenueGoogle` + `publicRating`). The one
 * thing this shape adds is `source` — which of the two stored numbers a
 * guest is actually seeing — and even that is asked of `publicRating`
 * rather than re-stated, so the app's verdict cannot drift from the menu's.
 */

export interface StaffRatingValue {
  value: number;
  count: number;
}

export interface StaffRatingPayload {
  /** The owner's switch. Off ⇒ `effective` is null whatever is stored. */
  enabled: boolean;
  placeId: string | null;
  /** What we last read from Google, if anything ever did. */
  fetched: (StaffRatingValue & { fetchedAt: string }) | null;
  /** What the owner typed themselves, if they did. */
  manual: (StaffRatingValue & { updatedAt: string }) | null;
  /** What a guest sees right now, and where it came from. */
  effective: (StaffRatingValue & { source: "fetched" | "manual" }) | null;
  /**
   * Google's own review form, or — with no Place ID — a Maps search for
   * the venue name. Never null in practice: the app discards a rating
   * whose link is not an http(s) URL, so a hand-typed number with no
   * Place ID still needs somewhere real to point.
   */
  reviewUrl: string | null;
  /** Does this deployment hold a Places API key? False turns the whole
   *  "fetch from Google" half of the screen into a hint. */
  canFetch: boolean;
}

export type StaffRatingView =
  { ok: true; value: StaffRatingPayload } | { ok: false; error: "no_venue" };

/** The card for the owner behind `userId`. */
export async function staffRatingView(userId: string): Promise<StaffRatingView> {
  const [google, venue] = await Promise.all([getVenueGoogle(userId), getVenueForUser(userId)]);
  if (!google.ok) return { ok: false, error: "no_venue" };
  const g = google.value;

  // The same row shape the public menu hands `publicRating`, rebuilt from
  // the already-parsed values — so the precedence rules live in exactly
  // one function for guests and for the owner alike.
  const row: VenueRatingRow = {
    googlePlaceId: g.placeId,
    googleRating: g.rating,
    googleRatingManual: g.manual,
    googleRatingEnabled: g.enabled,
  };
  const effective = publicRating(row);
  // Provenance without repeating the precedence: ask the same function
  // again with the hand-typed numbers taken away. Anything that survives
  // that came from Google.
  const fromGoogle =
    effective !== null && publicRating({ ...row, googleRatingManual: null }) !== null;

  const name = venue.ok ? venue.value.name : "";
  return {
    ok: true,
    value: {
      enabled: g.enabled,
      placeId: g.placeId,
      fetched: g.rating
        ? { value: g.rating.rating, count: g.rating.count, fetchedAt: g.rating.fetchedAt }
        : null,
      manual: g.manual
        ? { value: g.manual.rating, count: g.manual.count, updatedAt: g.manual.updatedAt }
        : null,
      effective: effective
        ? {
            value: effective.value,
            count: effective.count,
            source: fromGoogle ? "fetched" : "manual",
          }
        : null,
      reviewUrl: g.reviewUrl ?? (name ? mapsSearchUrl(name) : null),
      canFetch: Boolean(env.GOOGLE_PLACES_API_KEY),
    },
  };
}

/**
 * `{ ok: true, rating }` — the success answer of GET, PATCH and refresh
 * alike. A user with no venue at all (mid-onboarding) is a 404 rather
 * than an empty card: there is no restaurant to rate yet.
 */
export async function staffRatingResponse(userId: string): Promise<NextResponse> {
  const view = await staffRatingView(userId);
  if (!view.ok) {
    return withCors(NextResponse.json({ ok: false, error: "no_venue" }, { status: 404 }));
  }
  return withCors(NextResponse.json({ ok: true, rating: view.value }, { headers: STAFF_NO_STORE }));
}

/**
 * The second gate on the two routes that talk to Google. `requireStaff`
 * has already bounded requests per IP; this bounds the BILLABLE ones, and
 * is the same ceiling the dashboard's own Search / Refresh buttons sit
 * behind — an owner setting a Place ID up from the app and from the
 * browser draws on one budget.
 *
 * Returns the 429 to send, or null to carry on.
 */
export async function googleLookupLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await checkRateLimit(GOOGLE_LOOKUP_IP, clientIp(req));
  if (rl.ok) return null;
  return withCors(
    NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    ),
  );
}

/**
 * HTTP status for a lookup that produced no number.
 *
 * The split is "whose problem is it": a missing API key or a missing
 * Place ID are OUR state — nothing was asked of Google, and the owner
 * fixes it on this very screen — so they are a 409 the app turns into an
 * instruction. Everything else happened at Google's end and is a 502, the
 * honest code for an upstream that failed us.
 */
export function ratingLookupStatus(error: VenueRatingRefreshError): number {
  if (error === "no_venue") return 404;
  if (error === "no_api_key" || error === "no_place_id") return 409;
  return 502;
}
