import { NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { signInCustomerWithPassword } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { checkRateLimit, LOGIN_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Email sign-in for guests. One 401 for every failure mode — the response
 * never reveals whether an email exists.
 */

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request): Promise<NextResponse> {
  const rl = await checkRateLimit(LOGIN_IP, clientIp(request));
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

  const result = await signInCustomerWithPassword(
    context.tenantId,
    parsed.data.email,
    parsed.data.password,
  );
  if (!result.ok) {
    return withCors(NextResponse.json({ error: "invalid_credentials" }, { status: 401 }));
  }

  return withCors(
    NextResponse.json({
      token: result.value.token,
      customer: { email: result.value.email, name: result.value.name },
    }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
