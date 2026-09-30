import { NextResponse } from "next/server";
import { publishDraft } from "@/lib/menu-versions-service";
import { permittedUserId } from "@/lib/team-access";

export async function POST(): Promise<NextResponse> {
  const gate = await permittedUserId("menu");
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "unauthenticated" : "forbidden" },
      { status: gate.error },
    );
  }
  const userId = gate.userId;
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
