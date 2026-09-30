import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteCategory, renameCategory } from "@/lib/categories-service";
import { permittedUserId } from "@/lib/team-access";

const patchSchema = z.object({ name: z.string().trim().min(1).max(80) });

async function requireUser(): Promise<string | NextResponse> {
  const gate = await permittedUserId("menu");
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "unauthenticated" : "forbidden" },
      { status: gate.error },
    );
  }
  const userId = gate.userId;
  return userId;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await renameCategory(user, { id, name: parsed.data.name });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ category: result.value });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const result = await deleteCategory(user, id);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return new NextResponse(null, { status: 204 });
}
