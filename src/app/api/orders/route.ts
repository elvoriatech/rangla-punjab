import { NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { z } from "zod";
import { resolvePreviewContext } from "@/lib/preview-context";
import { placeOrder, placeOrderSchema } from "@/lib/order-service";
import { CUSTOMER_COOKIE, verifyCustomerToken } from "@/lib/customer-auth";
import { cookies } from "next/headers";
import { getOperatorSettings } from "@/lib/operator-settings";
import { checkRateLimit, ORDER_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { createLogger } from "@/lib/logger";

const log = createLogger();

/**
 * Guest order placement — public, anonymous, rate-limited per IP.
 * The body carries slug + the placeOrderSchema fields (items, order
 * type, contact, address); prices, totals, delivery fees, and
 * entitlement gates are all applied server-side from the database.
 */

const bodySchema = z.object({
  slug: z.string().min(1).max(120),
  ...placeOrderSchema.shape,
});

export async function POST(request: Request): Promise<NextResponse> {
  const rl = await checkRateLimit(ORDER_IP, clientIp(request));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  // P2-4: site kill switch. When the operator pauses the site, ordering is
  // closed — the menu stays viewable but no new orders are accepted.
  const settings = await getOperatorSettings();
  if (!settings.siteActive) {
    return withCors(NextResponse.json({ error: "ordering_paused" }, { status: 503 }));
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const context = await resolvePreviewContext(parsed.data.slug, null);
  if (!context || context.mode !== "public") {
    return withCors(NextResponse.json({ error: "unknown_venue" }, { status: 404 }));
  }

  const { slug: _slug, ...orderInput } = parsed.data;
  // Signed-in customer? Link the order so it appears in their history.
  // Auth is the opaque token (app header or web cookie) — a client can
  // never claim an arbitrary customerId.
  let customerId: string | null = null;
  const customerToken =
    request.headers.get("x-customer-token") ?? (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (customerToken) {
    const customer = await verifyCustomerToken(context.tenantId, customerToken);
    customerId = customer?.id ?? null;
  }
  const result = await placeOrder(context, orderInput, { customerId });
  if (!result.ok) {
    const status = result.error === "unknown_items" || result.error === "not_published" ? 409 : 400;
    return withCors(NextResponse.json({ error: result.error }, { status }));
  }

  // A replay is a retry of a submit that already succeeded (the guest's
  // first response was lost). 200 rather than 201 so the distinction is
  // visible in logs and to the client, but the body is identical — the
  // client must be able to carry on exactly as if it had just placed it.
  // Cash (or unspecified) → the receipt is mailed now. Card / PayPal →
  // markOrderPaid mails it once the payment settles, so the guest never
  // gets a "pay at the restaurant" receipt for an order they are about to
  // pay online. Replays already mailed on the first attempt.
  if (!result.value.replayed && (orderInput.intendedPayment ?? "cash") === "cash") {
    const { sendReceiptEmailForOrder } = await import("@/lib/receipt-email");
    void sendReceiptEmailForOrder(context.tenantId, result.value.orderId);
  }

  log.info(result.value.replayed ? "order.replayed" : "order.placed", {
    venueId: context.venueId,
    orderId: result.value.orderId,
    orderNumber: result.value.orderNumber,
    totalCents: result.value.totalCents,
  });
  return withCors(NextResponse.json(result.value, { status: result.value.replayed ? 200 : 201 }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
