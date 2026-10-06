import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";
import { removeStaffMember, teamErrorStatus, updateStaffMember } from "@/lib/team-service";

/**
 * PATCH  /api/v1/staff/team/{membershipId} { name, permissions } — rename
 *        a team member and set their ticked areas (takes effect on their
 *        next request; no sign-out needed).
 * DELETE /api/v1/staff/team/{membershipId} — remove them; their login is
 *        signed out everywhere. The owner's own row is not a staff row and
 *        answers 404.
 */

const patchSchema = z.object({ name: z.string(), permissions: z.array(z.string()) });

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "owner");
  if (!gate.ok) return gate.response;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }
  const { id } = await ctx.params;
  const result = await updateStaffMember(gate.staff.userId, id, parsed.data);
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

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req, "owner");
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const result = await removeStaffMember(gate.staff.userId, id);
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
