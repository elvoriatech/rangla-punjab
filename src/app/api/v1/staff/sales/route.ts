import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getDailySales } from "@/lib/daily-sales";
import { resolvePreviewContext } from "@/lib/preview-context";
import { parsePayFilter } from "@/lib/report-service";
import { getRestaurantSlug } from "@/lib/restaurant";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/sales?date=YYYY-MM-DD&pay=cash|online|paypal|… — one
 * day's sales for the app's "Tagesumsatz" screen: cash and online totals,
 * the split by payment type and the day's orders (newest first). Needs
 * the team box "reports"; the owner always passes. No date = today in the
 * venue's time zone.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req, "reports");
  if (!gate.ok) return gate.response;

  const ctx = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!ctx) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "unavailable" },
        { status: 503, headers: STAFF_NO_STORE },
      ),
    );
  }

  const q = req.nextUrl.searchParams;
  const sales = await getDailySales(
    gate.staff.userId,
    ctx.venueId,
    q.get("date"),
    parsePayFilter(q.get("pay")),
  );
  if (!sales) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: STAFF_NO_STORE },
      ),
    );
  }
  return withCors(NextResponse.json({ ok: true, ...sales }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
