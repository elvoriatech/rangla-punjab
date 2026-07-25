import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { createItem, createItemSchema, listItems } from "@/lib/items-service";
import { checkCap } from "@/lib/plan-gating";

async function requireUser(): Promise<string | NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return userId;
}

const listQuery = z.object({ categoryId: z.string().min(1) });

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const url = new URL(request.url);
  const parsed = listQuery.safeParse({ categoryId: url.searchParams.get("categoryId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await listItems(user, parsed.data.categoryId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ items: result.value });
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const parsed = createItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // Plan gate first — refuses at the API boundary with 402 so the client
  // can prompt an upgrade before the (comparatively expensive) create
  // path runs. Public reads never touch this.
  const cap = await checkCap(user, "items");
  if (!cap.allowed) {
    return NextResponse.json(
      { error: "plan_limit", resource: "items", limit: cap.limit, planCode: cap.planCode },
      { status: 402 },
    );
  }

  const result = await createItem(user, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ item: result.value }, { status: 201 });
}
