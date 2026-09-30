import { NextResponse } from "next/server";
import { z } from "zod";
import { asUser } from "@/lib/tenant";
import { signPreviewToken } from "@/lib/preview-token";
import { permittedUserId } from "@/lib/team-access";

const bodySchema = z.object({ venueId: z.string().min(1) });

/**
 * Issue a signed preview token for the caller's venue. The `asUser`
 * wrapper sets the tenant GUC so RLS confirms the venue actually belongs
 * to the caller — an attacker who guesses a venueId from another tenant
 * gets a 404, not a signed token for someone else's menu.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gate = await permittedUserId("menu");
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "unauthenticated" : "forbidden" },
      { status: gate.error },
    );
  }
  const userId = gate.userId;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await asUser(userId, async (tx) => {
    const venue = await tx.venue.findFirst({
      where: { id: parsed.data.venueId, deletedAt: null },
      select: { id: true, tenantId: true, slug: true },
    });
    if (!venue) return null;
    const token = signPreviewToken(venue.tenantId, venue.id);
    return { token, slug: venue.slug };
  });
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    token: result.token,
    url: `/?preview=${result.token}`,
  });
}
