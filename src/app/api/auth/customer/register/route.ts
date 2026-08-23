import { NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { registerCustomerWithPassword } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { checkRateLimit, SIGNUP_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Email sign-up for guests (the mobile app and web account page). Returns
 * the opaque customer token as JSON — the app stores it, the web caller
 * uses the server action instead (which also sets the cookie).
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(80).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const rl = await checkRateLimit(SIGNUP_IP, clientIp(request));
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

  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) return withCors(NextResponse.json({ error: "unknown_venue" }, { status: 404 }));

  const result = await registerCustomerWithPassword(
    context.tenantId,
    parsed.data.email,
    parsed.data.password,
    parsed.data.name,
  );
  if (!result.ok) return withCors(NextResponse.json({ error: result.error }, { status: 409 }));

  return withCors(
    NextResponse.json(
      {
        token: result.value.token,
        customer: { email: result.value.email, name: result.value.name },
      },
      { status: 201 },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
