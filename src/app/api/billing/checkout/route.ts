import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { createCheckout } from "@/lib/billing-service";
import { siteUrl } from "@/lib/public-menu";

const bodySchema = z.object({
  // Single flat operator support plan. Accepted (and optional) so existing
  // callers keep working; there is nothing else to choose.
  planCode: z.literal("support").default("support"),
});

export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const base = siteUrl();
  const result = await createCheckout(userId, parsed.data.planCode, {
    successUrl: `${base}/dashboard/billing?ok=1`,
    cancelUrl: `${base}/dashboard/billing?cancelled=1`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ url: result.url });
}
