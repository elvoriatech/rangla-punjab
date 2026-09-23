import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { CUSTOMER_COOKIE } from "@/lib/customer-auth";
import { deleteCustomerAccount } from "@/lib/customer-deletion";
import { authenticateCustomer } from "@/lib/customer-request";

/**
 * DELETE /api/v1/me/account — the guest deletes their own account (the
 * app's "Konto löschen"). Distinct from `DELETE /api/v1/me`, which only
 * signs this device out. Auth: bearer or cookie, like every /me route.
 * What deletion wipes and what it keeps: `customer-deletion.ts`.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateCustomer(req);
  if (!auth.ok) {
    const status = auth.reason === "unavailable" ? 503 : 401;
    return withCors(NextResponse.json({ ok: false, error: auth.reason }, { status }));
  }
  await deleteCustomerAccount(auth.tenantId, auth.customer.id);
  const res = withCors(NextResponse.json({ ok: true }));
  res.cookies.set(CUSTOMER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
