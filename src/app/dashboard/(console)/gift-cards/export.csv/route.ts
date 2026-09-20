import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getGiftCardReport, isGiftCardStatusFilter } from "@/lib/gift-card-service";
import { giftCardsToCsv } from "@/lib/gift-card-export";
import { getVenueForUser } from "@/lib/venue-service";

/**
 * CSV export — session-authenticated, same status filter as the page.
 *
 * ON THE CODE COLUMN: a gift card is a bearer instrument, so a file full
 * of spendable codes is a file worth stealing. We include the FORMATTED
 * code (ABCD-EFGH-JKMN) anyway, and nothing else that would let a reader
 * spend one: the owner's actual job with this file is matching a line to a
 * physical card on the counter or a query from their accountant, and a
 * card they cannot identify is a card they cannot reconcile. The share
 * token — the part that makes a card's link usable — is never exported,
 * the response is `no-store`, and the download needs an owner session.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) return NextResponse.json({ error: "no_venue" }, { status: 404 });
  const venue = venueResult.value;

  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const filter = isGiftCardStatusFilter(status) ? status : "all";
  const report = await getGiftCardReport(venue.tenantId, venue.id, filter);

  const slug = venue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const today = new Date().toISOString().slice(0, 10);
  const filename = `gift-cards-${slug}-${filter}-${today}.csv`;
  return new NextResponse(giftCardsToCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
