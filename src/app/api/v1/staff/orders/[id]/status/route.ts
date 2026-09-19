import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { advanceOrderStatus } from "@/lib/order-service";
import { getStaffOrder } from "@/lib/staff-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/orders/{id}/status  { "to": "preparing" }
 *
 * The one write the board makes. It goes through `advanceOrderStatus`,
 * the same service the dashboard's buttons call, so the loyalty credit
 * on a cash order marked done fires here exactly as it does there — the
 * app is another client of the lifecycle, never a second implementation
 * of it.
 *
 * `advanceOrderStatus` answers a bare boolean, so the 404/409 split is
 * decided by a read first: an id this tenant cannot see is `not_found`,
 * anything else the lifecycle refuses is `invalid_transition`.
 */

const bodySchema = z.object({ to: z.string().min(1).max(40) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  const before = await getStaffOrder(gate.staff.userId, id);
  if (!before) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }

  const moved = await advanceOrderStatus(gate.staff.userId, id, parsed.data.to);
  if (!moved.ok) {
    // Either the lifecycle refuses the jump, or two devices tapped at
    // once and the optimistic guard picked the other winner. Both are the
    // same thing to the client: re-read the board.
    return withCors(NextResponse.json({ ok: false, error: "invalid_transition" }, { status: 409 }));
  }

  const after = await getStaffOrder(gate.staff.userId, id);
  if (!after) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }
  return withCors(NextResponse.json({ ok: true, order: after }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
