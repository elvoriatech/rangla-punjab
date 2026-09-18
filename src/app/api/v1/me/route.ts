import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import {
  CUSTOMER_COOKIE,
  revokeCustomerToken,
  updateCustomerProfile,
  verifyCustomerToken,
  type CustomerProfile,
} from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, type RateLimitConfig } from "@/lib/rate-limit";
import { getRestaurantSlug } from "@/lib/restaurant";
import { signReceiptToken } from "@/lib/receipt-token";
import { asTenant } from "@/lib/tenant";

/**
 * GET /api/v1/me — the signed-in customer's profile + their orders
 * (server-side history: every device sees the same list). Auth: the
 * app's bearer header or the web cookie — same opaque token either way.
 * Each order ships a fresh receipt token so tracking/receipt links work
 * on any device.
 *
 * PATCH /api/v1/me — the guest edits their own profile: display name,
 * phone, and the delivery address checkout prefills from. Same auth.
 * Ordering back-fills the same fields (order-service), so this is the
 * "correct what the last order guessed" surface, not the only writer.
 *
 * DELETE /api/v1/me — log out (revoke this token everywhere).
 */

/** Profile edits are token-authenticated, so this is not brute-force
 *  defence — it bounds how much write traffic one device can aim at the
 *  database if the app ever loops on a failed save. Kept local: no other
 *  route shares this ceiling. */
const PROFILE_WRITE_IP: RateLimitConfig = {
  scope: "profile-write:ip",
  limit: 30,
  windowSec: 60,
  failOpen: true,
};

async function bearerOrCookie(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("x-customer-token");
  if (header) return header;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const store = await cookies();
  return store.get(CUSTOMER_COOKIE)?.value ?? null;
}

function profileBody(customer: CustomerProfile) {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    lastDeliveryAddress: customer.lastDeliveryAddress,
  };
}

/** Token → (tenant, customer), or the response to send instead. */
async function authenticate(
  req: NextRequest,
): Promise<
  { ok: true; tenantId: string; customer: CustomerProfile } | { ok: false; res: NextResponse }
> {
  const token = await bearerOrCookie(req);
  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) {
    return {
      ok: false,
      res: withCors(NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 })),
    };
  }
  const customer = await verifyCustomerToken(context.tenantId, token);
  if (!customer) {
    return {
      ok: false,
      res: withCors(NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 })),
    };
  }
  return { ok: true, tenantId: context.tenantId, customer };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.res;
  const { tenantId, customer } = auth;

  const orders = await asTenant(tenantId, (tx) =>
    tx.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        orderType: true,
        paymentStatus: true,
        totalCents: true,
        currency: true,
        createdAt: true,
      },
    }),
  );

  return withCors(
    NextResponse.json(
      {
        ok: true,
        customer: profileBody(customer),
        orders: orders.map((o) => ({
          orderId: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          orderType: o.orderType,
          paymentStatus: o.paymentStatus,
          totalCents: o.totalCents,
          currency: o.currency,
          placedAt: o.createdAt.toISOString(),
          receiptToken: signReceiptToken(o.id, tenantId),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}

/**
 * Only the three fields checkout reads. Email is deliberately absent —
 * it is the identity the IdP vouched for, not a profile field. An
 * omitted key leaves the field untouched; `lastDeliveryAddress: null`
 * clears it ("forget where I live"), which is why it is nullable and
 * name/phone are not.
 */
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    lastDeliveryAddress: z
      .object({
        street: z.string().trim().min(3).max(120),
        zip: z.string().trim().min(3).max(10),
        city: z.string().trim().max(80).optional(),
        note: z.string().trim().max(200).optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "empty" });

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(PROFILE_WRITE_IP, clientIp(req));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.res;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }

  const updated = await updateCustomerProfile(auth.tenantId, auth.customer.id, parsed.data);
  if (!updated) {
    // The row vanished between verifying the token and writing (deleted
    // account). Treat it as signed out rather than inventing a profile.
    return withCors(NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 }));
  }

  return withCors(
    NextResponse.json(
      { ok: true, customer: profileBody(updated) },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const token = await bearerOrCookie(req);
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (context && token) await revokeCustomerToken(context.tenantId, token);
  const res = withCors(NextResponse.json({ ok: true }));
  res.cookies.set(CUSTOMER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
