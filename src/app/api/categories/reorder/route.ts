import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { reorderCategories, reorderSchema } from "@/lib/categories-service";

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await reorderCategories(userId, parsed.data);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return new NextResponse(null, { status: 204 });
}
