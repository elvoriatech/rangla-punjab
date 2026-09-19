import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { searchPlaces } from "@/lib/google-rating";
import { googleLookupLimit, ratingLookupStatus } from "@/lib/staff-rating-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/rating/search  { query } → { ok, places: [{ id, name, address }] }
 *
 * "Find my restaurant on Google" — the whole Place ID setup without
 * leaving the app and without the owner ever meeting the words "Place
 * ID" in Google's developer console. Up to five candidates, which is
 * Google's own ceiling for the picker and also all anyone will read.
 *
 * `searchPlaces` refuses an empty query locally rather than spending a
 * billable request to be told nothing matched, so a blank box comes back
 * as `not_found` without any call going out.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const limited = await googleLookupLimit(req);
  if (limited) return limited;

  const body: unknown = await req.json().catch(() => null);
  const raw = (body as { query?: unknown } | null)?.query;
  const query = typeof raw === "string" ? raw : "";

  const result = await searchPlaces(query);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: ratingLookupStatus(result.error) },
      ),
    );
  }
  return withCors(
    NextResponse.json({ ok: true, places: result.places }, { headers: STAFF_NO_STORE }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
