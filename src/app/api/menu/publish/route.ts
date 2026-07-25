import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { publishDraft } from "@/lib/menu-versions-service";

export async function POST(): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const result = await publishDraft(userId);
  if (!result.ok) {
    const status = result.error === "no_draft" ? 409 : 422;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({
    publishedVersionId: result.publishedVersionId,
    publishedAt: result.publishedAt.toISOString(),
  });
}
