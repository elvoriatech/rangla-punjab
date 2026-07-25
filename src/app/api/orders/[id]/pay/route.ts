import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrderPayment } from "@/lib/connect-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { checkRateLimit, ORDER_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Guest starts an online payment for their order. Authenticated by the
 * order's HMAC receipt token (the same credential the receipt PDF
 * uses); everything else — amount, fee, entitlement, Connect status —
 * is derived server-side.
 */

const bodySchema = z.object({ token: z.string().min(10).max(2048) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rl = await checkRateLimit(ORDER_IP, clientIp(request));
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  // P2-4: site kill switch — no new payments while the site is paused.
  const settings = await getOperatorSettings();
  if (!settings.siteActive) {
    return NextResponse.json({ error: "ordering_paused" }, { status: 503 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const verified = verifyReceiptToken(parsed.data.token);
  if (!verified || verified.orderId !== id) {
    return NextResponse.json({ error: "invalid_token" }, { status: 403 });
  }

  const result = await createOrderPayment(verified.tenantId, id, parsed.data.token);
  if (!result.ok) {
    const status =
      result.error === "invalid_token" ? 403 : result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ url: result.url }, { status: 201 });
}
