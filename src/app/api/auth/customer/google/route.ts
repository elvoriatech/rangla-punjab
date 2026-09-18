import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { googleIdTokenAudiences, signInCustomer, verifyGoogleIdToken } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, DEVICE_IP } from "@/lib/rate-limit";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * POST /api/auth/customer/google — native one-tap sign-in.
 *
 * The device's Google SDK already holds a signed ID token; this trades
 * it for our own opaque customer token. No browser hop, no device code,
 * no polling — the same end state as the device flow, which is why the
 * response body is the token + profile shape that flow parks in Redis.
 *
 * Registration is the same upsert as every other provider: the identity
 * is Google's `sub`, so a guest who first signed in through the browser
 * flow lands on the SAME customer row rather than a duplicate.
 *
 * Rate limited per IP like the device endpoint: unauthenticated, and
 * every call costs a signature verification.
 */

const bodySchema = z.object({ idToken: z.string().min(20).max(4096) });

export async function POST(request: Request): Promise<NextResponse> {
  const rl = await checkRateLimit(DEVICE_IP, clientIp(request));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  // No OAuth client ids configured ⇒ we cannot tell our tokens from
  // anyone else's, so the endpoint is off rather than permissive. The
  // app falls back to the browser flow on a 503.
  if (!googleIdTokenAudiences().length) {
    return withCors(NextResponse.json({ error: "google_not_configured" }, { status: 503 }));
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const identity = await verifyGoogleIdToken(parsed.data.idToken);
  // One error for every rejection — bad signature, wrong audience, stale
  // token, unverified address. The client can only retry sign-in.
  if (!identity) return withCors(NextResponse.json({ error: "invalid_token" }, { status: 401 }));

  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) return withCors(NextResponse.json({ error: "unknown_venue" }, { status: 404 }));

  const signedIn = await signInCustomer(context.tenantId, "google", identity);
  return withCors(
    NextResponse.json(
      { token: signedIn.token, customer: signedIn.customer },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
