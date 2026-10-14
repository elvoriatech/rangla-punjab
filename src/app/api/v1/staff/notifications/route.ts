import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { staffNotifications } from "@/lib/staff-notifications";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/notifications — the app's bell: `{ unread, items }`,
 * newest first, only what this login's boxes cover (owner: all).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;
  const result = await staffNotifications(gate.staff);
  return withCors(NextResponse.json({ ok: true, ...result }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
