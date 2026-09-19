import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getStaffOrdering, updateStaffOrdering } from "@/lib/staff-menu-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET  /api/v1/staff/ordering  → { ok, ordering: { dineIn, takeaway, delivery,
 *                                   issueWindowHours, appCancelEnabled } }
 * PATCH /api/v1/staff/ordering       { takeaway?, delivery?, issueWindowHours? }
 *
 * "Stop taking delivery orders, we're swamped." The GET exists so the app can
 * draw the switches from the owner's stored config rather than from the
 * edge-cached guest menu, whose `ordering` block is the plan-gated EFFECTIVE
 * view and may be up to five minutes stale — a switch that snaps back after a
 * tap is worse than no switch.
 *
 * `dineIn` is reported but not settable here: turning the room off is a
 * closing-the-restaurant decision, and it stays in the dashboard.
 *
 * `issueWindowHours` (P7-10) rides along because it is the same kind of
 * setting — an owner switch the app draws and can change on the spot —
 * and because the dashboard's Settings form writes the identical key.
 *
 * `appCancelEnabled` is READ-ONLY here, and that is the whole point of it:
 * the GET reports it so the app can say "cancelling is switched off" instead
 * of drawing a dead button, but the PATCH body has no such key (unknown keys
 * are stripped, so sending one changes nothing). Cancelling is terminal and
 * gets tapped by accident on a phone carried through a service, so arming it
 * is a decision the owner makes in the web dashboard — never one the app can
 * make for itself. Enforcement of the switch lives on
 * `POST /api/v1/staff/orders/{id}/status` (409 `cancel_disabled`).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const ordering = await getStaffOrdering(gate.staff.tenantId);
  return withCors(NextResponse.json({ ok: true, ordering }, { headers: STAFF_NO_STORE }));
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const result = await updateStaffOrdering(gate.staff.tenantId, body);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 400;
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error, ...(result.field ? { field: result.field } : {}) },
        { status },
      ),
    );
  }
  return withCors(
    NextResponse.json({ ok: true, ordering: result.value }, { headers: STAFF_NO_STORE }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
