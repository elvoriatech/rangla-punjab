import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { ISSUE_BODY_MAX, replyToIssue, withPhotoUrls } from "@/lib/issue-service";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/issues/{id}/messages  { body }
 *
 * The restaurant's reply. Text only — the guest is the one who needs to
 * show what went wrong; the restaurant needs to answer for it.
 *
 * A reply moves an open thread to `answered`. On a RESOLVED thread it is
 * still accepted (an afterthought, a "your refund is on its way") and
 * leaves the status alone: closing is a decision, not a side effect of
 * typing.
 */
const replySchema = z.object({ body: z.string().trim().min(1).max(ISSUE_BODY_MAX) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const parsed = replySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  const result = await replyToIssue(gate.staff.userId, id, parsed.data.body);
  if (!result.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: result.error },
        { status: result.error === "not_found" ? 404 : 400 },
      ),
    );
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
