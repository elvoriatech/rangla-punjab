import { NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { signInCustomerWithPassword } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { checkRateLimit, LOGIN_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { signInRestaurant } from "@/lib/staff-auth";

/**
 * Email sign-in for everyone who opens the app. One 401 for every failure
 * mode — the response never reveals whether an email exists, nor which
 * KIND of account it is.
 *
 * Two kinds of account share this form:
 *   - `kind: "guest"`   — a customer row; the body is exactly what it has
 *                         always been, plus the discriminator.
 *   - `kind: "restaurant"` — the dashboard owner of this deploy's single
 *                         venue, signing in to the orders board.
 *
 * Precedence is guest-first and deliberate: if the same address has a
 * guest account, that wins. The restaurant login is only ever tried when
 * nothing matched as a guest, so an owner who also eats here keeps their
 * guest history and has to sign in with the dashboard address to reach
 * the board.
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
  if (result.ok) {
    return withCors(
      NextResponse.json({
        kind: "guest",
        token: result.value.token,
        customer: { email: result.value.email, name: result.value.name },
      }),
    );
  }

  // No guest matched. The same credentials may be the restaurant's.
  const restaurant = await signInRestaurant(
    { tenantId: context.tenantId, venueId: context.venueId },
    parsed.data.email,
    parsed.data.password,
  );
  if (restaurant) {
    return withCors(
      NextResponse.json({
        kind: "restaurant",
        token: restaurant.token,
        restaurant: { name: restaurant.name, email: restaurant.email },
      }),
    );
  }

  return withCors(NextResponse.json({ error: "invalid_credentials" }, { status: 401 }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
