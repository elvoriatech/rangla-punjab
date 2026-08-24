import { NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { createReservation, reservationSchema } from "@/lib/reservation-service";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, RESERVATION_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Guest table-reservation request — public, anonymous, rate-limited per
 * IP. Date/time are re-validated against the venue's opening hours
 * server-side; the dialog's slot list is convenience, not authority.
 */

const bodySchema = z.object({
  slug: z.string().min(1).max(120),
  ...reservationSchema.shape,
});

export async function POST(request: Request): Promise<NextResponse> {
  const rl = await checkRateLimit(RESERVATION_IP, clientIp(request));
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

  const context = await resolvePreviewContext(parsed.data.slug, null);
  if (!context || context.mode !== "public") {
    return withCors(NextResponse.json({ error: "unknown_venue" }, { status: 404 }));
  }

  const { slug: _slug, ...input } = parsed.data;
  const result = await createReservation(context, input);
  if (!result.ok) {
    const status = result.error === "reservations_off" ? 403 : 400;
    return withCors(NextResponse.json({ error: result.error }, { status }));
  }
  return withCors(NextResponse.json(result.value, { status: 201 }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
