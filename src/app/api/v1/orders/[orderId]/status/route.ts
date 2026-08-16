import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getOrderTracking } from "@/lib/order-service";
import { guestSteps, statusChain, stepIndex } from "@/lib/order-status";

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
            labelDe: s.de,
            labelEn: s.en,
            reached: i <= current,
          })),
          orderType: order.orderType,
          paymentStatus: order.paymentStatus,
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
