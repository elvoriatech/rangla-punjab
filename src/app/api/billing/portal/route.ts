import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { createBillingPortal } from "@/lib/billing-service";
import { siteUrl } from "@/lib/public-menu";

export async function POST(): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await createBillingPortal(userId, `${siteUrl()}/dashboard/billing`);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ url: result.url });
}
