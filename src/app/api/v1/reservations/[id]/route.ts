import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { checkRateLimit, RESERVATION_READ_IP } from "@/lib/rate-limit";
import { getReservationForGuest } from "@/lib/reservation-service";
import { verifyReservationToken } from "@/lib/reservation-token";

/**
 * GET /api/v1/reservations/{id}?token=…
 *
 * "Did the restaurant confirm my table?" — the mirror of the order
 * tracker, for a request that may have been made with no account at all.
 * The signed reservation token handed back by `POST /api/reservations` is
 * the whole credential, and it carries the tenant, so the read needs no
 * session and no cross-tenant lookup.
 *
 * Never cached: the URL carries no identity a CDN could key on, and the
 * status is exactly the thing that changes.
 *
 * Contract rules, same as the order tracker: ISO timestamps, and clients
 * MUST tolerate a `status` value they don't recognize — the lifecycle may
 * grow after an app has shipped.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rl = await checkRateLimit(RESERVATION_READ_IP, clientIp(req));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  const { id } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const claim = verifyReservationToken(token);
  // A token for a DIFFERENT reservation is as invalid as a forged one —
  // and answering 403 either way means the route never confirms whether
  // an id exists to someone holding the wrong token.
  if (!claim || claim.reservationId !== id) {
    return withCors(NextResponse.json({ ok: false, error: "invalid_token" }, { status: 403 }));
  }

  const reservation = await getReservationForGuest(claim.tenantId, id);
  if (!reservation) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }

  return withCors(
    NextResponse.json(
      { ok: true, reservation },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
