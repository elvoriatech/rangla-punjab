import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { dispatchOrder } from "@/lib/dispatch-service";
import { STAFF_NO_STORE, requireStaff } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/orders/{id}/dispatch — the in-app twin of the web
 * dispatch page.
 *
 * When a driver's phone has the staff app installed, the ticket's QR
 * opens the app instead of the browser (see the deep-link config in
 * `mobile/App.tsx`), and the app calls this. Same transition, same
 * idempotence; the difference is only that the caller is already
 * authenticated as staff, so there is no token in play.
 *
 * `already: true` is a SUCCESS, not a conflict: a second driver scanning
 * the same ticket needs to be told "it is on the way" and sent to the
 * route, not handed an error they will try to work around.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const result = await dispatchOrder(gate.staff.tenantId, id, "staff-app");

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return withCors(
      NextResponse.json({ ok: false, error: result.error }, { status, headers: STAFF_NO_STORE }),
    );
  }

  return withCors(
    NextResponse.json(
      {
        ok: true,
        already: result.already,
        orderNumber: result.orderNumber,
        customerName: result.customerName,
        addressLine: result.addressLine,
        directionsUrl: result.directionsUrl,
        status: result.status,
      },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
