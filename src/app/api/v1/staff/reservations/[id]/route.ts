import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { setReservationStatus } from "@/lib/reservation-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

const bodySchema = z.object({ status: z.enum(["confirmed", "declined", "cancelled"]) });

/**
 * POST /api/v1/staff/reservations/{id} `{ status }` — the dashboard's
 * Confirm / Decline / Cancel buttons, from the restaurant app. The guest
 * sees the new status on their own reservation card (web and app) on its
 * next read; nothing is sent to them from here.
 *
 * Any settable status may follow any other, as on the dashboard: an owner
 * who declined by mistake confirms the same row a second later.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "reservations");
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }
  const { id } = await ctx.params;
  const result = await setReservationStatus(gate.staff.userId, id, parsed.data.status);
  if (!result.ok) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }
  return withCors(
    NextResponse.json({ ok: true, status: parsed.data.status }, { headers: STAFF_NO_STORE }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
