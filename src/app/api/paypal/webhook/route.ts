import { NextResponse } from "next/server";
import { handlePayPalWebhook, parsePayPalWebhookHeaders } from "@/lib/paypal-webhook-handler";
import { captureException } from "@/lib/observability";

/**
 * PayPal webhook receiver — the server-to-server sibling of the return
 * leg, so an order the guest approved but never came back for still
 * settles. The restaurant registers this URL under its own PayPal app
 * (events CHECKOUT.ORDER.APPROVED + PAYMENT.CAPTURE.COMPLETED) and
 * pastes the resulting Webhook ID in Dashboard → Payments; that id is
 * what lets us ask PayPal whether a delivery is genuine.
 *
 * Read the body as text: PayPal verifies the exact bytes on the wire.
 * 2xx = "stop retrying"; 4xx = "bad payload, don't retry"; 5xx = "retry".
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const headers = parsePayPalWebhookHeaders((name) => request.headers.get(name));
  if (!headers) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  try {
    const outcome = await handlePayPalWebhook({ rawBody, headers });
    if (outcome.status === 200) {
      return NextResponse.json({ received: true, kind: outcome.kind }, { status: 200 });
    }
    return NextResponse.json({ error: outcome.kind }, { status: 400 });
  } catch (err) {
    captureException(err, { route: "paypal-webhook" });
    // 500 asks PayPal to retry — the idempotency guard makes the retry safe.
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
