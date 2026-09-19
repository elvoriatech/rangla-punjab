import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { customerToken } from "@/lib/customer-request";
import { createReservation, reservationSchema } from "@/lib/reservation-service";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, RESERVATION_IP } from "@/lib/rate-limit";
import { signReservationToken } from "@/lib/reservation-token";
import { clientIp } from "@/lib/client-ip";

/**
 * Guest table-reservation request — public, anonymous, rate-limited per
 * IP. Date/time are re-validated against the venue's opening hours
 * server-side; the dialog's slot list is convenience, not authority.
 *
 * Sign-in is OPTIONAL and stays optional: when the request happens to
 * carry a customer token (the app's header, the web's cookie) the row is
 * linked to that guest so `/account` and the app can list it later. No
 * token, no link, same 201.
 *
 * The response carries a signed reservation token — the anonymous guest's
 * whole credential for reading their own status back on
 * `/api/v1/reservations/{id}`.
 */

const bodySchema = z.object({
  slug: z.string().min(1).max(120),
  ...reservationSchema.shape,
});

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  // Resolved against the tenant the reservation is FOR, not against the
  // deployment's default venue: a token minted for another restaurant is
  // simply not a guest here, and the reservation stays anonymous.
  const token = await customerToken(request);
  const customer = token ? await verifyCustomerToken(context.tenantId, token) : null;

  const { slug: _slug, ...input } = parsed.data;
  const result = await createReservation(context, input, { customerId: customer?.id ?? null });
  if (!result.ok) {
    const status = result.error === "reservations_off" ? 403 : 400;
    return withCors(NextResponse.json({ error: result.error }, { status }));
  }
  return withCors(
    NextResponse.json(
      {
        ...result.value,
        // `id` duplicates `reservationId` on purpose: shipped web code
        // reads the old key, the app reads the short one, and dropping
        // either would break a client we don't control.
        id: result.value.reservationId,
        token: signReservationToken(result.value.reservationId, context.tenantId),
      },
      { status: 201 },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
