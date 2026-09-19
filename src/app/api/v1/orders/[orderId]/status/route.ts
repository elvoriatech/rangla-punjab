import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getOrderTracking } from "@/lib/order-service";
import { guestSteps, statusChain, stepIndex } from "@/lib/order-status";
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

  const order = await getOrderTracking(claim.tenantId, orderId);
  if (!order)
    return withCors(NextResponse.json({ ok: false, error: "not_found" }, { status: 404 }));

  const steps = guestSteps(order.orderType);
  const current = stepIndex(order.status, order.orderType);
  // The step labels are catalogue keys now; the payload keeps its original
  // de/en pair so shipped app builds keep rendering. An app that wants
  // another language reads `key` and looks it up in its own catalogue.
  const stepsDe = postOrderCopy("de").steps;
  const stepsEn = postOrderCopy("en").steps;
  return withCors(
    NextResponse.json(
      {
        ok: true,
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
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
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
