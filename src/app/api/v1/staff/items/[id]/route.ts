import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { updateStaffItem } from "@/lib/staff-menu-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * PATCH /api/v1/staff/items/{id}
 *   { isAvailable?, priceCents?, offer?: {...} | null }
 *
 * Sold out, new price, offer on, offer off — the four things an owner changes
 * without wanting to think about drafts and publishing. The write lands on
 * the published row AND its draft twin, so it is live for guests immediately
 * and survives the next publish; `mirrored: false` in the answer means only
 * one row could be found (see the migration for when that happens).
 *
 * `offer: null` REMOVES the offer; omitting the key leaves it untouched. A
 * refusal carries `field` so the app can highlight the control rather than
 * showing a generic error.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const result = await updateStaffItem(gate.staff.tenantId, id, body);

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
    NextResponse.json(
      { ok: true, item: result.value.item, mirrored: result.value.mirrored },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
