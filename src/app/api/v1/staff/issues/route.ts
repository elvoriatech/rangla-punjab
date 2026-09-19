import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { listStaffIssues } from "@/lib/issue-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * GET /api/v1/staff/issues[?all=1]
 *
 * The restaurant's complaints list. Unresolved only by default — that is
 * the working set, and a screen that opens on six months of settled
 * grievances is a screen nobody opens twice. `all=1` is the "Show
 * resolved" toggle.
 *
 * Summaries, not threads: each row carries the order it belongs to, the
 * last thing said and how many turns there were, which is everything the
 * list renders. The messages come from `/issues/{id}`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const all = req.nextUrl.searchParams.get("all") === "1";
  const issues = await listStaffIssues(gate.staff.userId, { includeResolved: all });
  return withCors(NextResponse.json({ ok: true, issues }, { headers: STAFF_NO_STORE }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
