import { NextResponse } from "next/server";
import { reorderCategories, reorderSchema } from "@/lib/categories-service";
import { permittedUserId } from "@/lib/team-access";

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await permittedUserId("menu");
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "unauthenticated" : "forbidden" },
      { status: gate.error },
    );
  }
  const userId = gate.userId;
  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await reorderCategories(userId, parsed.data);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return new NextResponse(null, { status: 204 });
}
