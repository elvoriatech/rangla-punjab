import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getOrderLog } from "@/lib/order-log-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/** GET /api/v1/staff/order-log/{orderId} — one order's full history with
 *  the raw JSON of every step. Team box "orders". */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "orders");
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const detail = await getOrderLog(gate.staff.userId, id);
  if (!detail) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: STAFF_NO_STORE },
      ),
    );
  }
  return withCors(
    NextResponse.json(
      {
        ok: true,
        ...detail,
        row: {
          ...detail.row,
          firstAt: detail.row.firstAt.toISOString(),
          lastAt: detail.row.lastAt.toISOString(),
        },
        events: detail.events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
