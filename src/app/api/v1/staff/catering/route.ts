import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { listCateringRequests } from "@/lib/catering-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/catering
 *
 * The restaurant app's catering enquiries — the dashboard's Catering list:
 * every event from a month ago onwards, soonest event first, every status.
 * `date` / `time` are the venue-local day the guest asked for (`time` may
 * be null — catering often starts with "some time that Saturday").
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req, "catering");
  if (!gate.ok) return gate.response;

  const rows = await listCateringRequests(gate.staff.userId);
  const requests = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    guests: r.guests,
    date: r.date,
    time: r.time,
    location: r.location,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
  return withCors(NextResponse.json({ ok: true, requests }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
