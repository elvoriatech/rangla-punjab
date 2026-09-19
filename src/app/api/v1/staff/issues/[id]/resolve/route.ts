import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { resolveIssue, withPhotoUrls } from "@/lib/issue-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/issues/{id}/resolve — close the thread.
 *
 * Only the restaurant may do this, and it is the one move that makes the
 * guest side read-only. Idempotent: a double tap on a slow connection
 * re-stamps the row rather than erroring, and the thread stays visible
 * behind the list's "Show resolved" toggle.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const result = await resolveIssue(gate.staff.userId, id);
  if (!result.ok) {
    return withCors(NextResponse.json({ ok: false, error: result.error }, { status: 404 }));
  }
  return withCors(
    NextResponse.json(
      { ok: true, issue: withPhotoUrls(result.issue) },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
