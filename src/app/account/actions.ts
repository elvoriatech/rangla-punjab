"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CUSTOMER_COOKIE, revokeCustomerToken } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";

/** Sign the customer out: revoke the token server-side, drop the cookie. */
export async function logoutCustomerAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE)?.value;
  if (token) {
    const slug = await getRestaurantSlug();
    const context = await resolvePreviewContext(slug, null);
    if (context) await revokeCustomerToken(context.tenantId, token);
  }
  store.set(CUSTOMER_COOKIE, "", { path: "/", maxAge: 0 });
  redirect("/account");
}
