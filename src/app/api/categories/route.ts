import { NextResponse } from "next/server";
import { createCategory, createSchema, listCategories } from "@/lib/categories-service";
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

export async function GET(): Promise<NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const list = await listCategories(user);
  if (!list.ok) return NextResponse.json({ error: list.error }, { status: 409 });
  return NextResponse.json({ categories: list.value });
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await createCategory(user, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ category: result.value }, { status: 201 });
}
