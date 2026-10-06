import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { DELETE_REASON_MAX, deleteCancelledOrder } from "@/lib/order-delete-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

const bodySchema = z.object({ reason: z.string().max(DELETE_REASON_MAX * 2) });

/**
 * POST /api/v1/staff/orders/{id}/delete `{ reason }` — the dashboard's
 * "delete cancelled order", from the app. Owner only, and only a cancelled
 * order no money moved on (`orderDeleteBlock`); the order number, total
 * and reason stay in the deleted-orders log the reports show.
 *
 *   403 forbidden        — a team member (only the owner deletes)
 *   404 not_found
 *   409 not_cancelled | money_moved
 *   400 reason_required  — fewer than 3 characters of reason
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "owner");
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "reason_required" }, { status: 400 }));
  }
  const { id } = await ctx.params;
  const result = await deleteCancelledOrder(gate.staff.userId, id, parsed.data.reason);
  if (!result.ok) {
    const status =
      result.error === "forbidden"
        ? 403
        : result.error === "not_found"
          ? 404
          : result.error === "reason_required"
            ? 400
            : 409;
    return withCors(NextResponse.json({ ok: false, error: result.error }, { status }));
  }
  return withCors(
    NextResponse.json({ ok: true, orderNumber: result.orderNumber }, { headers: STAFF_NO_STORE }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
