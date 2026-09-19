import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { listStaffMenu } from "@/lib/staff-menu-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/menu
 *
 * The published menu as the RESTAURANT sees it: every dish, including the
 * ones currently switched off, with the raw offer fields rather than the
 * collapsed `offer` the guest endpoint sends. `offerActive` says whether the
 * window is open right now so the app never has to reimplement
 * `offer-pricing.ts` to draw a badge.
 *
 * Published, not draft, because this screen exists to change what guests are
 * looking at this minute — see `staff-menu-service.ts` for why the writes
 * touch both halves of the pair.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const categories = await listStaffMenu(gate.staff.tenantId);
  return withCors(NextResponse.json({ ok: true, categories }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
