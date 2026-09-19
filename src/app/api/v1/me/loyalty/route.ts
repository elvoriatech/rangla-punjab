import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import { DISABLED_SUMMARY, getLoyaltySummary } from "@/lib/loyalty-service";

/**
 * GET /api/v1/me/loyalty — the signed-in guest's points, vouchers and the
 * last 20 ledger movements. Auth is the same opaque customer token the
 * rest of `/api/v1/me` takes (bearer header from the app, cookie from the
 * web), and the answer is private/no-store: a balance must never be
 * cached by a CDN keyed on a URL that carries no identity.
 *
 * When the owner has loyalty switched off the response is still 200 with
 * `enabled: false` and zeroed numbers, so a client needs exactly one
 * branch rather than a 404 path of its own.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateCustomer(req);
  if (!auth.ok) {
    const status = auth.reason === "unavailable" ? 503 : 401;
    const error = auth.reason === "unavailable" ? "unavailable" : "unauthorized";
    return withCors(NextResponse.json({ ok: false, error }, { status }));
  }

  const loyalty = await getLoyaltySummary(auth.tenantId, auth.customer.id).catch(
    // A loyalty read must never cost the guest their profile screen.
    () => DISABLED_SUMMARY,
  );

  return withCors(
    NextResponse.json({ ok: true, loyalty }, { headers: { "Cache-Control": "private, no-store" } }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
