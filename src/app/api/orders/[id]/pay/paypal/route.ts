import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { corsPreflight, withCors } from "@/lib/cors";
import { createPayPalOrderPayment } from "@/lib/paypal-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { checkRateLimit, ORDER_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Guest starts a PayPal payment — the PayPal sibling of
 * POST /api/orders/{id}/pay. Same auth (receipt token), same kill
 * switch, same rate limit; returns the approve URL to redirect to.
 */

const bodySchema = z.object({
  token: z.string().min(10).max(2048),
  // App deep link for the "Back to the app" return leg; validated by
  // sanitizeAppReturnUrl (app schemes only), silently dropped otherwise.
  app: z.string().max(600).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const rl = await checkRateLimit(ORDER_IP, clientIp(request));
  if (!rl.ok) return withCors(NextResponse.json({ error: "rate_limited" }, { status: 429 }));

  const settings = await getOperatorSettings();
  if (!settings.siteActive) {
    return withCors(NextResponse.json({ error: "ordering_paused" }, { status: 503 }));
  }
  // Availability (the Billing on/off switch + keys) is decided by
  // createPayPalOrderPayment, which answers `not_available` → 409.

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const verified = verifyReceiptToken(parsed.data.token);
  if (!verified || verified.orderId !== id) {
    return withCors(NextResponse.json({ error: "invalid_token" }, { status: 403 }));
  }

  const result = await createPayPalOrderPayment(
    verified.tenantId,
    id,
    parsed.data.token,
    sanitizeAppReturnUrl(parsed.data.app),
  );
  if (!result.ok) {
    const status =
      result.error === "invalid_token" ? 403 : result.error === "not_found" ? 404 : 409;
    return withCors(NextResponse.json({ error: result.error }, { status }));
  }
  return withCors(NextResponse.json({ url: result.url }, { status: 201 }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
