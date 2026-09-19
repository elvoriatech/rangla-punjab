import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getStaffHours, updateStaffHours } from "@/lib/staff-hours-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET   /api/v1/staff/hours → { ok, timezone, hours: { mon … sun }, openNow }
 * PATCH /api/v1/staff/hours   { hours: { mon … sun } }
 *
 * "We're closing early today." The owner standing in their own restaurant
 * edits the week from the counter instead of finding a laptop.
 *
 * The read exists separately from the guest menu's `openState` for the
 * same reason `/staff/ordering` does: the public payload is edge-cached
 * and may be minutes stale, and a grid that snaps back after an edit is
 * worse than no grid. `openNow` rides along so the app can draw the badge
 * without shipping the timezone maths — it is computed on OUR clock in
 * the venue's timezone, so a device with a skewed clock still agrees with
 * what guests see.
 *
 * Validation and the write both live in `staff-hours-service`, which
 * copies the dashboard form's rules and goes through the same
 * `compileWeekly` + `updateVenueHours` pair — one dialect of the JSONB,
 * two editors.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const result = await getStaffHours(gate.staff.userId);
  if (!result.ok) {
    return withCors(NextResponse.json({ ok: false, error: result.error }, { status: 404 }));
  }
  return withCors(NextResponse.json({ ok: true, ...result.value }, { headers: STAFF_NO_STORE }));
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const result = await updateStaffHours(gate.staff.userId, body);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 400;
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: result.error,
          ...(result.error === "invalid" && result.field ? { field: result.field } : {}),
        },
        { status },
      ),
    );
  }
  return withCors(NextResponse.json({ ok: true, ...result.value }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
