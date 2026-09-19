import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getStaffLoyaltyOverview } from "@/lib/staff-loyalty-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/loyalty — the programme's state and its regulars.
 *
 * Read-only on purpose: the numbers that define a point are a pricing
 * decision and live in the dashboard, while this is the counter-side view
 * ("is Amrit's free meal real?"). The member list is the top 50 balances, so
 * one request stays one screenful of data however many regulars a venue has.
 *
 * Personal data — names and email addresses — so it rides the same
 * owner-membership gate as the orders board and is never cached.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const overview = await getStaffLoyaltyOverview(gate.staff.tenantId);
  return withCors(NextResponse.json({ ok: true, ...overview }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
