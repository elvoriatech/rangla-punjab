import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import { listCustomerReservations } from "@/lib/reservation-service";

/**
 * GET /api/v1/me/reservations — the signed-in guest's table requests,
 * newest first, across every device. Auth is the same opaque customer
 * token the rest of `/api/v1/me` takes (bearer header from the app,
 * cookie from the web).
 *
 * Only reservations made WHILE signed in appear here: an anonymous
 * request has nothing linking it to an account, and the token returned at
 * creation time (`/api/v1/reservations/{id}`) remains the way to read
 * those back. A guest with none gets `reservations: []`, not a 404, so
 * clients need one branch instead of two.
 *
 * `private, no-store`: the URL carries no identity, so nothing on the
 * path may cache this answer.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateCustomer(req);
  if (!auth.ok) {
    const status = auth.reason === "unavailable" ? 503 : 401;
    const error = auth.reason === "unavailable" ? "unavailable" : "unauthorized";
    return withCors(NextResponse.json({ ok: false, error }, { status }));
  }

  const reservations = await listCustomerReservations(auth.tenantId, auth.customer.id);

  return withCors(
    NextResponse.json(
      { ok: true, reservations },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
