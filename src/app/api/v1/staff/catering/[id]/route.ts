import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { setCateringStatus } from "@/lib/catering-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

const bodySchema = z.object({ status: z.enum(["confirmed", "declined", "cancelled"]) });

/**
 * POST /api/v1/staff/catering/{id} `{ status }` — the dashboard's
 * Confirm / Decline / Cancel on one catering enquiry, from the app. The
 * restaurant usually calls the guest back first; this records the answer.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "catering");
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }
  const { id } = await ctx.params;
  const result = await setCateringStatus(gate.staff.userId, id, parsed.data.status);
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
