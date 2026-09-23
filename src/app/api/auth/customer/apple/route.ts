import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { signInCustomer, verifyAppleIdToken } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, DEVICE_IP } from "@/lib/rate-limit";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * POST /api/auth/customer/apple — Sign in with Apple from the iOS app.
 *
 * Same contract as the native Google route next door: a signed identity
 * token in, our own opaque customer token + profile out. `name` is what
 * Apple's sheet returned on the guest's FIRST sign-in (Apple never puts
 * it in the token); display-only, like every provider's name.
 */

const bodySchema = z.object({
  idToken: z.string().min(20).max(4096),
  name: z.string().trim().max(120).optional(),
});

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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const identity = await verifyAppleIdToken(parsed.data.idToken, parsed.data.name);
  if (!identity) return withCors(NextResponse.json({ error: "invalid_token" }, { status: 401 }));

  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) return withCors(NextResponse.json({ error: "unknown_venue" }, { status: 404 }));

  const signedIn = await signInCustomer(context.tenantId, "apple", identity);
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
