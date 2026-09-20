import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import {
  findGiftCardByCode,
  getGiftCardReport,
  isGiftCardStatusFilter,
} from "@/lib/gift-card-service";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { STAFF_NO_STORE, requireStaff } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/gift-cards
 *
 *   ?code=… — look ONE card up, for the confirm step of a redemption:
 *             the cashier types a code, sees the value and who bought it,
 *             and only then commits. Deliberately a separate read from
 *             the redeem POST so "look" and "spend" are never one tap.
 *   (none)  — the venue's whole gift-card book plus totals, mirroring
 *             the dashboard page for the owner's phone.
 *
 * A lookup returns the card whatever its state — an expired or
 * already-redeemed card is exactly what staff most need to SEE, so they
 * can tell the guest why rather than "not found".
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const card = await findGiftCardByCode(gate.staff.tenantId, code);
    if (!card) {
      return withCors(
        NextResponse.json(
          { ok: false, error: "unknown" },
          { status: 404, headers: STAFF_NO_STORE },
        ),
      );
    }
    return withCors(NextResponse.json({ ok: true, card }, { headers: STAFF_NO_STORE }));
  }

  const ctx = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!ctx) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "unavailable" },
        { status: 503, headers: STAFF_NO_STORE },
      ),
    );
  }

  const raw = req.nextUrl.searchParams.get("status") ?? undefined;
  const filter = isGiftCardStatusFilter(raw) ? raw : "all";
  const report = await getGiftCardReport(gate.staff.tenantId, ctx.venueId, filter);

  return withCors(
    NextResponse.json(
      { ok: true, cards: report.rows, totals: report.totals, filter },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
