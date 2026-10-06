import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { listReservations } from "@/lib/reservation-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/reservations
 *
 * The restaurant app's table requests — the same list the dashboard's
 * Reservations page shows: everything from six hours ago onwards, soonest
 * first, every status. The app groups by `date` and puts the buttons on
 * the `requested` rows; the server stays out of presentation.
 *
 * `date` / `time` are the venue-local wall clock the guest picked, which
 * is what the owner reads; `at` is the same moment as an instant, for
 * sorting and "is this past?".
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req, "reservations");
  if (!gate.ok) return gate.response;

  const rows = await listReservations(gate.staff.userId);
  const reservations = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    guests: r.guests,
    at: r.at.toISOString(),
    date: r.date,
    time: r.time,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
  return withCors(NextResponse.json({ ok: true, reservations }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
