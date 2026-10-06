import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";
import { PERMISSIONS } from "@/lib/team-permissions";
import { createStaffMember, listTeam, teamErrorStatus } from "@/lib/team-service";

/**
 * The owner's Team page, from the app (owner only — a team member gets
 * 403 even with every box ticked, exactly as on the web).
 *
 * GET  /api/v1/staff/team → { ok, members, areas }
 * POST /api/v1/staff/team   { name, email, password, permissions }
 *
 * `areas` is the list of boxes in their fixed order, so the app draws the
 * same checkboxes the dashboard does without hard-coding them.
 */

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req, "owner");
  if (!gate.ok) return gate.response;

  const result = await listTeam(gate.staff.userId);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: teamErrorStatus(result.error) },
      ),
    );
  }
  const members = result.value.map((m) => ({
    id: m.membershipId,
    email: m.email,
    name: m.displayName,
    isOwner: m.isOwner,
    permissions: m.permissions,
    createdAt: m.createdAt.toISOString(),
  }));
  return withCors(
    NextResponse.json({ ok: true, members, areas: PERMISSIONS }, { headers: STAFF_NO_STORE }),
  );
}

const createSchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string(),
  permissions: z.array(z.string()),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req, "owner");
  if (!gate.ok) return gate.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }
  const result = await createStaffMember(gate.staff.userId, parsed.data);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: teamErrorStatus(result.error) },
      ),
    );
  }
  return withCors(NextResponse.json({ ok: true }, { status: 201, headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
