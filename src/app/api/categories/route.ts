import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { createCategory, createSchema, listCategories } from "@/lib/categories-service";

async function requireUser(): Promise<string | NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
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
