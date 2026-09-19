import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { getStaffIssue, withPhotoUrls } from "@/lib/issue-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/issues/{id} — one thread in full.
 *
 * Photo URLs carry NO token: the restaurant's app fetches them with the
 * `X-Staff-Token` image header it already holds, and the dashboard rides
 * its session cookie. Putting a guest token in a staff answer would hand
 * the restaurant a shareable link to their own guest's photo.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const issue = await getStaffIssue(gate.staff.userId, id);
  if (!issue) {
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));
  }
  return withCors(
    NextResponse.json({ ok: true, issue: withPhotoUrls(issue) }, { headers: STAFF_NO_STORE }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
