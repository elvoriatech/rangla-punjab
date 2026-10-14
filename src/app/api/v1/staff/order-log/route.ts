import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { dayBounds, parseSalesDay } from "@/lib/daily-sales";
import { listOrderLog, parseOrderLogFilter } from "@/lib/order-log-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/order-log?date=YYYY-MM-DD&q=…&f=all|payment_open|… —
 * the app's order history: the day's logged orders (or a 6-month search),
 * the same data as the dashboard's Order log. Team box "orders".
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req, "orders");
  if (!gate.ok) return gate.response;
  const sp = req.nextUrl.searchParams;
  const date = parseSalesDay(sp.get("date"), "Europe/Berlin");
  const { from, to } = dayBounds(date, "Europe/Berlin");
  const rows = await listOrderLog(gate.staff.userId, {
    from,
    to: new Date(to.getTime() + 1),
    q: (sp.get("q") ?? "").slice(0, 100),
    filter: parseOrderLogFilter(sp.get("f") ?? undefined),
  });
  return withCors(
    NextResponse.json(
      {
        ok: true,
        date,
        orders: rows.map((r) => ({
          ...r,
          firstAt: r.firstAt.toISOString(),
          lastAt: r.lastAt.toISOString(),
        })),
      },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
