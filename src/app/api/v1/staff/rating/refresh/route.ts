import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import {
  googleLookupLimit,
  ratingLookupStatus,
  staffRatingResponse,
} from "@/lib/staff-rating-service";
import { requireStaff } from "@/lib/staff-request";
import { refreshVenueGoogleRating } from "@/lib/venue-service";

/**
 * POST /api/v1/staff/rating/refresh → { ok, rating } | { ok: false, error }
 *
 * "Ask Google now." The once-a-day cache exists because a rating moves
 * slowly and every read is billable; an owner who has just pasted a Place
 * ID is the one case where waiting is wrong — they want to know this
 * minute whether the id they picked is their own restaurant.
 *
 * Failure is reported in Google's vocabulary, not as a generic 500: the
 * app turns each code into one plain sentence, and "the server has no API
 * key" and "Google has never heard of that place" need completely
 * different things done about them.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const limited = await googleLookupLimit(req);
  if (limited) return limited;

  const result = await refreshVenueGoogleRating(gate.staff.userId);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: ratingLookupStatus(result.error) },
      ),
    );
  }
  // The whole card, not just the number that changed: the refresh moves
  // `effective` and its `source` too, and the screen redraws from this.
  return staffRatingResponse(gate.staff.userId);
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
