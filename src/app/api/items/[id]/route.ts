import { NextResponse } from "next/server";
import { softDeleteItem, updateItem, updateItemSchema } from "@/lib/items-service";
import { permittedUserId } from "@/lib/team-access";

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
  const parsed = updateItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await updateItem(user, id, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ item: result.value });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const result = await softDeleteItem(user, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return new NextResponse(null, { status: 204 });
}
