import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { listStaffOrders } from "@/lib/staff-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/orders?since=<ISO>
 *
 * The restaurant's live board: every open order, plus the 50 most recent
 * finished ones. `since` makes it a delta — pass the `serverTime` of the
 * previous answer and only rows written since come back. `serverTime` is
 * echoed rather than left to the device precisely so a phone with a
 * skewed clock still polls against OUR clock.
 *
 * An unparseable `since` is ignored rather than rejected: a full board is
 * always a safe answer, a 400 mid-service is not.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const raw = req.nextUrl.searchParams.get("since");
  const parsed = raw ? new Date(raw) : null;
  const since = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;

  const orders = await listStaffOrders(gate.staff.userId, since);
  return withCors(
    NextResponse.json(
      { ok: true, serverTime: new Date().toISOString(), orders },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
