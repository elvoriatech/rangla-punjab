import { NextRequest, NextResponse } from "next/server";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { finalizeGiftCardPayPalReturn } from "@/lib/gift-card-payment";
import { siteUrl } from "@/lib/site-url";

/**
 * GET /api/gift-cards/paypal/return — where PayPal sends the buyer back.
 *
 * The browser-return leg, and the gift-card twin of
 * `/api/paypal/return`. It is a convenience, not the source of truth:
 * the webhook settles the same purchase independently, because a guest
 * who closes the tab after approving still paid. Both converge on
 * `activateGiftCard`, which only ever flips `pending_payment → active`,
 * so whichever arrives second is a no-op.
 *
 * Nothing here trusts the query string with money: the ids select a row,
 * and the capture is done against the ref stored on that row.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const cardId = params.get("cardId");
  const tenantId = params.get("tenantId");
  const app = sanitizeAppReturnUrl(params.get("app"));

  if (!cardId || !tenantId) {
    return NextResponse.redirect(`${siteUrl()}/`, 303);
  }

  const result = await finalizeGiftCardPayPalReturn(tenantId, cardId).catch(() => ({
    paid: false,
  }));
  const status = result.paid ? "success" : "failed";

  // Same hand-over as the order return leg: the app opened PayPal
  // directly and was never showing a page of ours, so `/auth/app-return`
  // throws the browser straight back into it rather than leaving the
  // guest on a dead-end web page they have to tap out of.
  if (app) {
    return NextResponse.redirect(
      `${siteUrl()}/auth/app-return?to=${encodeURIComponent(app)}&status=${status}`,
      303,
    );
  }
  return NextResponse.redirect(`${siteUrl()}/?giftcard=${status}`, 303);
}
