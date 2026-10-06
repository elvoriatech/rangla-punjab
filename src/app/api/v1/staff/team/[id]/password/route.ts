import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";
import { setStaffPassword, teamErrorStatus } from "@/lib/team-service";

const bodySchema = z.object({ password: z.string() });

/**
 * POST /api/v1/staff/team/{membershipId}/password { password } — the owner
 * sets a new password for a team member (they forgot it, or it leaked).
 * Signs that person out on every device.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "owner");
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }
  const { id } = await ctx.params;
  const result = await setStaffPassword(gate.staff.userId, id, parsed.data.password);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: teamErrorStatus(result.error) },
      ),
    );
  }
  return withCors(NextResponse.json({ ok: true }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
