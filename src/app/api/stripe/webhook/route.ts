import { NextResponse } from "next/server";
import { getStripeProvider } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe/webhook-handler";
import { captureException } from "@/lib/observability";

/**
 * Stripe webhook receiver. Signature verification uses the *raw* request
 * body (Stripe's HMAC is over the exact bytes on the wire), so we read
 * `request.text()` — never `request.json()`.
 *
 * We return 400 on any signature failure and 500 only on unexpected
 * internal errors. Every 2xx tells Stripe "keep going"; 4xx tells it
 * "your payload is bad, don't retry"; 5xx tells it "retry later".
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const provider = await getStripeProvider();
  let event;
  try {
    event = provider.constructWebhookEvent(body, signature);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event);
    return NextResponse.json({ received: true, kind: outcome.kind }, { status: outcome.status });
  } catch (err) {
    captureException(err, { eventId: event.id, eventType: event.type });
    // 500 asks Stripe to retry — the idempotency guard makes the retry safe.
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
