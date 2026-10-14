import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getStaffSummary } from "@/lib/staff-service";
import { staffNotifications } from "@/lib/staff-notifications";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/summary — the three numbers the app puts on its tab
 * badges: work outstanding, money outstanding, reservations awaiting an
 * answer. Counts only; the board itself is `/api/v1/staff/orders`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const [summary, bell] = await Promise.all([
    getStaffSummary(gate.staff.userId),
    staffNotifications(gate.staff).catch(() => ({ unread: 0 })),
  ]);
  // `unreadNotifications`: the number on the app's bell.
  return withCors(
    NextResponse.json(
      { ok: true, ...summary, unreadNotifications: bell.unread },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
