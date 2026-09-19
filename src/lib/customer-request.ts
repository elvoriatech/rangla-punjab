import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { CUSTOMER_COOKIE, verifyCustomerToken, type CustomerProfile } from "./customer-auth";
import { resolvePreviewContext } from "./preview-context";
import { getRestaurantSlug } from "./restaurant";

/**
 * "Who is this guest?" for the customer-token endpoints under
 * `/api/v1/me`. The app sends a bearer header, the web sends the session
 * cookie, and both carry the SAME opaque token — so one resolver serves
 * every caller.
 *
 * Deliberately returns a reason rather than a response: `/api/v1/me`
 * answers `unauthenticated` (its shipped contract, which mobile builds
 * already branch on) while the loyalty endpoints answer `unauthorized`.
 * Baking a response in here would have forced one of them to change.
 */

export async function customerToken(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("x-customer-token");
  if (header) return header;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const store = await cookies();
  return store.get(CUSTOMER_COOKIE)?.value ?? null;
}

export type CustomerAuth =
  | { ok: true; tenantId: string; customer: CustomerProfile }
  | { ok: false; reason: "unavailable" | "unauthenticated" };

export async function authenticateCustomer(req: NextRequest): Promise<CustomerAuth> {
  const token = await customerToken(req);
  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) return { ok: false, reason: "unavailable" };
  const customer = await verifyCustomerToken(context.tenantId, token);
  if (!customer) return { ok: false, reason: "unauthenticated" };
  return { ok: true, tenantId: context.tenantId, customer };
}
