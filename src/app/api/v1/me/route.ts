import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { CUSTOMER_COOKIE, revokeCustomerToken, verifyCustomerToken } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
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
 * DELETE /api/v1/me — log out (revoke this token everywhere).
 */

async function bearerOrCookie(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("x-customer-token");
  if (header) return header;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const store = await cookies();
  return store.get(CUSTOMER_COOKIE)?.value ?? null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = await bearerOrCookie(req);
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (!context)
    return withCors(NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 }));

  const customer = await verifyCustomerToken(context.tenantId, token);
  if (!customer) {
    return withCors(NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 }));
  }

  const orders = await asTenant(context.tenantId, (tx) =>
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
        customer: { email: customer.email, name: customer.name },
        orders: orders.map((o) => ({
          orderId: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          orderType: o.orderType,
          paymentStatus: o.paymentStatus,
          totalCents: o.totalCents,
          currency: o.currency,
          placedAt: o.createdAt.toISOString(),
          receiptToken: signReceiptToken(o.id, context.tenantId),
        })),
      },
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
