import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePreviewContext } from "@/lib/preview-context";
import { placeOrder, placeOrderSchema } from "@/lib/order-service";
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
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // P2-4: site kill switch. When the operator pauses the site, ordering is
  // closed — the menu stays viewable but no new orders are accepted.
  const settings = await getOperatorSettings();
  if (!settings.siteActive) {
    return NextResponse.json({ error: "ordering_paused" }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const context = await resolvePreviewContext(parsed.data.slug, null);
  if (!context || context.mode !== "public") {
    return NextResponse.json({ error: "unknown_venue" }, { status: 404 });
  }

  const { slug: _slug, ...orderInput } = parsed.data;
  const result = await placeOrder(context, orderInput);
  if (!result.ok) {
    const status = result.error === "unknown_items" || result.error === "not_published" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  log.info("order.placed", {
    venueId: context.venueId,
    orderId: result.value.orderId,
    orderNumber: result.value.orderNumber,
    totalCents: result.value.totalCents,
  });
  return NextResponse.json(result.value, { status: 201 });
}
