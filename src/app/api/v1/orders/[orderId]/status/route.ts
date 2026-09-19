import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getOrderTracking } from "@/lib/order-service";
import { guestSteps, isCancelledStatus, statusChain, stepIndex } from "@/lib/order-status";
import { getGuestIssueState } from "@/lib/issue-service";
import { reviewPromptFor, trackedReviewUrl } from "@/lib/google-rating";
import { postOrderCopy } from "@/lib/i18n/post-order";

/**
 * GET /api/v1/orders/{id}/status?token=…
 *
 * The mobile app's tracking read. Token-authorized (the receipt token
 * returned by order placement is the guest's whole credential), never
 * cached. Contract rules: integer cents, ISO timestamps, and clients
 * MUST tolerate status values they don't recognize — the server may
 * grow the lifecycle after the app shipped.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const { orderId } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const claim = verifyReceiptToken(token);
  if (!claim || claim.orderId !== orderId) {
    return withCors(NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 }));
  }

  const [order, issueState] = await Promise.all([
    getOrderTracking(claim.tenantId, orderId),
    getGuestIssueState(claim.tenantId, orderId),
  ]);
  if (!order)
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));

  const steps = guestSteps(order.orderType);
  const current = stepIndex(order.status, order.orderType);
  // The step labels are catalogue keys now; the payload keeps its original
  // de/en pair so shipped app builds keep rendering. An app that wants
  // another language reads `key` and looks it up in its own catalogue.
  const stepsDe = postOrderCopy("de").steps;
  const stepsEn = postOrderCopy("en").steps;
  // "Rate us on Google": present whenever the venue has a Place ID and
  // the owner hasn't switched the rating off — independent of the
  // order's status, because WHEN to ask is the client's decision (the
  // app shows it on a finished order, same as the web tracker).
  const review = reviewPromptFor(order, order.customer);
  return withCors(
    NextResponse.json(
      {
        ok: true,
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          // P7-17. `cancelled` is off the chain, so `currentStepIndex`
          // comes back as -1 and the steps are all unreached — correct,
          // but easy for a client to render as "step 1 of 4, nothing
          // done yet". This flag is the unambiguous read: draw the
          // cancelled state, and stop polling.
          cancelled: isCancelledStatus(order.status),
          statusChain: statusChain(order.orderType),
          currentStepIndex: current,
          steps: steps.map((s, i) => ({
            key: s.key,
            labelKey: s.label,
            labelDe: stepsDe[s.label],
            labelEn: stepsEn[s.label],
            reached: i <= current,
          })),
          orderType: order.orderType,
          paymentStatus: order.paymentStatus,
          // "voucher" is a settled order a loyalty reward paid for in
          // full — the app must read it as paid, not as a card payment
          // still to come.
          paymentProvider: order.paymentProvider,
          items: order.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            priceCents: i.priceCents,
            lineTotalCents: i.priceCents * i.quantity,
          })),
          // The reward applied to this order, and what is left to pay:
          // `totalCents` stays the CHARGED total (already net of the
          // discount), so an app that never learns about rewards keeps
          // showing the right number.
          discountCents: order.discountCents,
          totalCents: order.totalCents,
          currency: order.currency,
          tableNumber: order.tableNumber,
          requestedFor: order.requestedFor ? order.requestedFor.toISOString() : null,
          placedAt: order.createdAt.toISOString(),
        },
        // P7-10. Two fields rather than the whole thread: this is the
        // polling endpoint, and all a tracking screen needs to know is
        // whether to draw a pill and whether to offer the button. The
        // messages come from `/issue` when the guest opens it.
        //
        // The pill is deliberately sticky — a complaint survives the
        // order reaching `done`, which is precisely when most of them
        // are written.
        issue: issueState?.issue
          ? { status: issueState.issue.status, updatedAt: issueState.issue.updatedAt }
          : null,
        canReport: issueState?.canReport ?? false,
        // The write-a-review ask, in two fields. The rating NUMBER is
        // deliberately still absent — it reaches the app through the menu
        // payload, and a second copy here would be a second thing to keep
        // in step. Null = no Place ID, or the owner switched the rating
        // off: draw no call-to-action at all.
        //
        // `url` is OUR tracked redirect, not Google's form: following it
        // is how the tap gets recorded (Google never tells us whether a
        // review was written). It carries the caller's own token, so it
        // grants nothing the caller didn't already hold.
        //
        // `prompted` is "they already tapped it" — hide the button. The
        // url stays live underneath on purpose: a guest who taps, gets
        // distracted and comes back through an old receipt must still
        // land on the review form rather than a dead link.
        review: review
          ? { url: trackedReviewUrl(order.id, token), prompted: review.prompted }
          : null,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
