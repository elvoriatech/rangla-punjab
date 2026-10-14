import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { markStaffNotificationsSeen } from "@/lib/staff-notifications";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/** POST /api/v1/staff/notifications/seen — the bell was opened: count → 0. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;
  await markStaffNotificationsSeen(gate.staff);
  return withCors(NextResponse.json({ ok: true }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
