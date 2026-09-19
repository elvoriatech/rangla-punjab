import { NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import {
  CUSTOMER_PASSWORD_MIN_LENGTH,
  consumeCustomerPasswordReset,
} from "@/lib/customer-password-reset";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";

/**
 * Spend a guest reset token. The token is in the path (it arrived in a
 * link), the new password in the body.
 *
 * The password policy is the register route's, stated once in
 * `customer-auth.ts` — a reset must never be a way to set a weaker
 * password than sign-up allows. The success body carries NO session: the
 * reset revoked every live token on purpose, so the guest signs in again
 * with the password they just chose.
 */

const bodySchema = z.object({
  password: z.string().min(CUSTOMER_PASSWORD_MIN_LENGTH).max(200),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "invalid" }, { status: 400 }));

  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) return withCors(NextResponse.json({ error: "unknown_venue" }, { status: 404 }));

  const result = await consumeCustomerPasswordReset(context.tenantId, token, parsed.data.password);
  if (!result.ok) {
    if (result.error === "weak_password") {
      return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
    }
    return withCors(NextResponse.json({ ok: false, error: "invalid_or_expired" }, { status: 410 }));
  }
  return withCors(NextResponse.json({ ok: true }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
