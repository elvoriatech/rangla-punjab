import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/cors";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { customerToken } from "@/lib/customer-request";
import { cateringSchema, createCateringRequest } from "@/lib/catering-service";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, CATERING_IP } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Guest catering enquiry — public, anonymous, rate-limited per IP, the
 * sibling of `/api/reservations`. The date window (tomorrow … four
 * months) is re-checked server-side against the venue's own timezone.
 *
 * Sign-in stays optional exactly as for reservations: a customer token,
 * when present, links the row to the guest; without one the enquiry is
 * anonymous and the phone number is how the restaurant gets back.
 */

const bodySchema = z.object({
  slug: z.string().min(1).max(120),
  ...cateringSchema.shape,
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(CATERING_IP, clientIp(request));
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

  const token = await customerToken(request);
  const customer = token ? await verifyCustomerToken(context.tenantId, token) : null;

  const { slug: _slug, ...input } = parsed.data;
  const result = await createCateringRequest(context, input, { customerId: customer?.id ?? null });
  if (!result.ok) return withCors(NextResponse.json({ error: result.error }, { status: 400 }));
  return withCors(
    NextResponse.json({ id: result.value.requestId, ...result.value }, { status: 201 }),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
