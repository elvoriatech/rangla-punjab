import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { venueReviewLink } from "@/lib/google-rating";
import { createLogger } from "@/lib/logger";
import { checkRateLimit, ORDER_IP } from "@/lib/rate-limit";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { asTenant } from "@/lib/tenant";

/**
 * GET /api/v1/orders/{id}/review?token=… → 302 to Google's write-a-review
 * form.
 *
 * Every "Rate us on Google" button — web tracker, account page, receipt
 * email, mobile app — points here instead of at Google directly, for one
 * reason: the owner wants the ask to stop once a guest has acted on it,
 * and Google publishes NO signal about whether a review was written. No
 * callback, no API, nothing. The only event that happens on a server we
 * own is the guest leaving our page for theirs, so that is the event we
 * record. `review_clicked_at` means exactly "they tapped" and never
 * "they reviewed" — the columns are named for the tap on purpose.
 *
 * Authorized like `/status`: the receipt token IS the guest's whole
 * credential, and the claim's `orderId` must match the path so a token
 * for order A can never mark order B as asked.
 *
 * Idempotent, in the literal sense that matters here: the write is a
 * conditional `updateMany` on a still-NULL column, so the first tap wins
 * the timestamp and every later one is a no-op that still redirects. A
 * spent link must keep WORKING — a bookmarked receipt, a second tap from
 * the same email, the back button — it just stops being advertised.
 */

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

const log = createLogger();

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const { orderId } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const claim = verifyReceiptToken(token);
  if (!claim || claim.orderId !== orderId) {
    return withCors(
      NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401, headers: NO_STORE }),
    );
  }

  // The guest half of the order API is anonymous, so per-IP is the only
  // handle there is on someone spraying this at guessed order ids. The
  // ordering limiter is the right existing bucket: same route family,
  // same audience, already fail-open so a Redis blip can never stand
  // between a guest and a review form.
  const limit = await checkRateLimit(ORDER_IP, clientIp(req));
  if (!limit.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } },
      ),
    );
  }

  const order = await asTenant(claim.tenantId, (tx) =>
    tx.order.findFirst({
      where: { id: orderId },
      select: { id: true, venueId: true, customerId: true, reviewClickedAt: true },
    }),
  );
  if (!order) {
    return withCors(
      NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE }),
    );
  }

  // No Place ID, or the owner switched the rating off: there is nowhere
  // honest to send the guest. A Maps search is not a review form, so this
  // 404s rather than inventing a destination.
  const link = await venueReviewLink(claim.tenantId, order.venueId);
  if (!link) {
    return withCors(
      NextResponse.json({ ok: false, error: "no_review_link" }, { status: 404, headers: NO_STORE }),
    );
  }

  // Both writes are conditional on the column still being NULL, which is
  // what makes a second tap free: no row updated, first instant kept.
  // A signed-in regular's tap is remembered on the ACCOUNT as well, so
  // March's review does not get re-asked from April's order.
  const now = new Date();
  await asTenant(claim.tenantId, async (tx) => {
    if (order.reviewClickedAt === null) {
      await tx.order.updateMany({
        where: { id: orderId, reviewClickedAt: null },
        data: { reviewClickedAt: now },
      });
    }
    if (order.customerId) {
      await tx.customer.updateMany({
        where: { id: order.customerId, reviewClickedAt: null },
        data: { reviewClickedAt: now },
      });
    }
  });
  log.info("review.clicked", { orderId, tenantId: claim.tenantId });

  // 302, not 301: a permanent redirect is exactly the thing a browser is
  // allowed to cache and replay without ever reaching us again, which
  // would silently blind the only signal this route exists to collect.
  const res = NextResponse.redirect(link.reviewUrl, 302);
  res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return withCors(res);
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
