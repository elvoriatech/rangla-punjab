import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { CONTACT_FIELDS, type ContactField } from "@/lib/contact-config";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";
import { getVenueContact, updateVenueContact } from "@/lib/venue-service";

/**
 * GET   /api/v1/staff/contact  → { ok, contact: { landline, mobile, whatsapp } }
 * PATCH /api/v1/staff/contact    { landline?, mobile?, whatsapp? }
 *
 * "Put the new mobile on the menu." The owner half of the contact card, for
 * the app: the same write the dashboard's Settings card performs, behind the
 * staff token instead of a dashboard session.
 *
 * The three values here are RAW E.164 strings (or null) — not the guest
 * projection with its `display` and `href`. This is the editor's own read:
 * the app draws three text inputs from it and posts them back, so it must
 * see exactly what is stored rather than a formatted version it would then
 * have to unformat.
 *
 * Every key is optional and only the ones PRESENT travel: an absent
 * `whatsapp` leaves that number alone, and `whatsapp: null` (or "") clears
 * it. The whole patch validates before any of it is written, and a refusal
 * names the field — the app puts the message under that input, not at the
 * top of the card.
 */

function invalid(field?: ContactField): NextResponse {
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

  const result = await getVenueContact(gate.staff.userId);
  if (!result.ok) return noVenue();
  return withCors(
    NextResponse.json({ ok: true, contact: result.value }, { headers: STAFF_NO_STORE }),
  );
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid();
  const raw = body as Partial<Record<ContactField, unknown>>;

  // Nothing to do is a mistake, not a no-op: the app only sends this verb
  // when the owner has touched one of the three boxes.
  const present = CONTACT_FIELDS.filter((f) => raw[f] !== undefined);
  if (present.length === 0) return invalid();

  const patch: Partial<Record<ContactField, string | null>> = {};
  for (const field of present) {
    const value = raw[field];
    // A number is a string here even when it is all digits: JSON numbers
    // lose the leading zero and the plus, which are the two characters that
    // decide what the number means.
    if (value !== null && typeof value !== "string") return invalid(field);
    patch[field] = value;
  }

  const saved = await updateVenueContact(gate.staff.userId, patch);
  if (!saved.ok) return saved.error === "no_venue" ? noVenue() : invalid(saved.field);

  // The numbers are on every cached copy of the public menu, so a change
  // that isn't purged is a phone number nobody can ring for five minutes.
  const { purgeMenuForTenant } = await import("@/lib/cdn-purge");
  await purgeMenuForTenant(gate.staff.tenantId);

  const after = await getVenueContact(gate.staff.userId);
  if (!after.ok) return noVenue();
  return withCors(
    NextResponse.json({ ok: true, contact: after.value }, { headers: STAFF_NO_STORE }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
