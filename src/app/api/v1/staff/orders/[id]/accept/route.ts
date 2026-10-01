import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { acceptOrderWithEta } from "@/lib/order-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";
import { getStaffOrder } from "@/lib/staff-service";

/**
 * POST /api/v1/staff/orders/{id}/accept — accept a new order with the
 * time the restaurant promises: `{ minutes }` (snapped to a multiple of
 * 5 in 5–180 on the server).
 *
 * Refusals the app branches on:
 *   404 not_found       — no such order in this restaurant
 *   409 window_closed   — the accept window ran out; the default applies
 *   409 not_applicable  — planned / dine-in, already accepted or moved on
 * In both 409 cases the answer is the same for the client: re-read the
 * board, and the card comes back with the plain "prepare" button.
 */

const bodySchema = z.object({ minutes: z.number().finite() });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "orders");
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  const result = await acceptOrderWithEta(gate.staff.userId, id, parsed.data.minutes);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: result.error === "not_found" ? 404 : 409 },
      ),
    );
  }
  const order = await getStaffOrder(gate.staff.userId, id);
  if (!order) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }
  return withCors(NextResponse.json({ ok: true, order }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
