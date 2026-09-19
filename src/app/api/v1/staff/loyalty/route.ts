import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getStaffLoyaltyOverview, updateStaffLoyalty } from "@/lib/staff-loyalty-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET   /api/v1/staff/loyalty → { ok, enabled, config, totals, members }
 * PATCH /api/v1/staff/loyalty   { enabled?, minOrderCents?, pointsPerOrder?,
 *                                 rewardPoints?, rewardValueCents?,
 *                                 voucherExpiryMonths? }
 *
 * The counter-side view of the programme ("is Amrit's free meal real?") plus
 * the one switch an owner reaches for without walking to a laptop: turn
 * loyalty off. The body is a PARTIAL of the `config` block the GET returns,
 * merged onto the stored config — so an app build that only knows `enabled`
 * can never blank out the numbers a newer dashboard set.
 *
 * The member list is the top 50 balances, so one request stays one screenful
 * of data however many regulars a venue has.
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

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const result = await updateStaffLoyalty(gate.staff.userId, gate.staff.tenantId, body);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 400;
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error, ...(result.field ? { field: result.field } : {}) },
        { status },
      ),
    );
  }

  // Same read-your-own-writes courtesy the dashboard's own save does: an
  // owner who flips the switch in the app and then opens Settings must not
  // see the old state. The CDN purge (in the service) is the load-bearing
  // half; this only touches Next's own page cache, and is a no-op outside a
  // request scope — hence the guard, which keeps direct handler calls (tests,
  // scripts) from blowing up on an invariant that has nothing to do with the
  // write that already succeeded.
  try {
    revalidatePath("/dashboard/settings", "page");
    revalidatePath("/dashboard", "page");
  } catch {
    /* no rendering context — nothing to revalidate */
  }

  return withCors(NextResponse.json({ ok: true, ...result.value }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
