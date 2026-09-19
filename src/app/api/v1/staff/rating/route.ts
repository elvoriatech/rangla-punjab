import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { normaliseManualRating } from "@/lib/google-rating";
import { staffRatingResponse } from "@/lib/staff-rating-service";
import { requireStaff } from "@/lib/staff-request";
import {
  GOOGLE_PLACE_ID_RE,
  updateVenueGoogleManualRating,
  updateVenueGooglePlaceId,
  updateVenueGoogleRatingEnabled,
} from "@/lib/venue-service";

/**
 * GET   /api/v1/staff/rating  → { ok, rating: { enabled, placeId, fetched, manual, effective, reviewUrl, canFetch } }
 * PATCH /api/v1/staff/rating    { enabled?, manual?: { value, count } | null, placeId?: string | null }
 *
 * "Show our Google stars — and fix the number while I'm standing here."
 * The owner half of P7-14, for the app: the same three writes the
 * dashboard's Google card performs, behind the staff token instead of a
 * dashboard session, and answering with the whole card every time so the
 * screen can redraw from the response alone.
 *
 * Every key is optional and only the ones PRESENT travel — an absent
 * `manual` leaves the typed numbers alone, `manual: null` clears them.
 * Validation runs over the whole patch before any of it is written, so a
 * body carrying a good switch and a bad number changes nothing at all;
 * and a rejection names the field (`value`, `count`, `placeId`) because
 * the app puts the message under that input, not at the top of the form.
 */

type PatchField = "value" | "count" | "placeId";

function invalid(field?: PatchField): NextResponse {
  return withCors(
    NextResponse.json(
      { ok: false, error: "invalid", ...(field ? { field } : {}) },
      { status: 400 },
    ),
  );
}

function noVenue(): NextResponse {
  return withCors(NextResponse.json({ ok: false, error: "no_venue" }, { status: 404 }));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  return staffRatingResponse(gate.staff.userId);
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid();
  const patch = body as { enabled?: unknown; manual?: unknown; placeId?: unknown };

  // Nothing to do is a mistake, not a no-op: the app only sends this verb
  // when the owner touched something.
  if (patch.enabled === undefined && patch.manual === undefined && patch.placeId === undefined) {
    return invalid();
  }

  /* -------- validate the whole patch before writing any of it -------- */

  if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") return invalid();

  let placeId: string | undefined;
  if (patch.placeId !== undefined) {
    if (patch.placeId !== null && typeof patch.placeId !== "string") return invalid("placeId");
    // An empty string is the clear, same as null — that is the dashboard
    // form's contract and `updateVenueGooglePlaceId` already means it.
    placeId = patch.placeId === null ? "" : patch.placeId.trim();
    if (placeId.length > 0 && !GOOGLE_PLACE_ID_RE.test(placeId)) return invalid("placeId");
  }

  // The service takes the two raw form strings; the app sends numbers. The
  // shared gate is `normaliseManualRating`, asked once for the verdict and
  // — only when it refuses — a second time with a known-good count, which
  // is what tells the two inputs apart without restating either rule.
  let manual: { rating: string; count: string } | undefined;
  if (patch.manual !== undefined) {
    if (patch.manual === null) {
      manual = { rating: "", count: "" };
    } else {
      if (typeof patch.manual !== "object" || Array.isArray(patch.manual)) return invalid("value");
      const m = patch.manual as { value?: unknown; count?: unknown };
      const parsed = normaliseManualRating(m.value, m.count);
      if (!parsed) return invalid(normaliseManualRating(m.value, 0) ? "count" : "value");
      manual = { rating: String(parsed.rating), count: String(parsed.count) };
    }
  }

  /* ----------------------------- write ------------------------------ */

  const userId = gate.staff.userId;
  if (typeof patch.enabled === "boolean") {
    const saved = await updateVenueGoogleRatingEnabled(userId, patch.enabled);
    if (!saved.ok) return saved.error === "no_venue" ? noVenue() : invalid();
  }
  if (placeId !== undefined) {
    const saved = await updateVenueGooglePlaceId(userId, placeId);
    if (!saved.ok) return saved.error === "no_venue" ? noVenue() : invalid("placeId");
  }
  if (manual !== undefined) {
    const saved = await updateVenueGoogleManualRating(userId, manual);
    if (!saved.ok) return saved.error === "no_venue" ? noVenue() : invalid("value");
  }

  return staffRatingResponse(userId);
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
