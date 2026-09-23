"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_TOKEN_TTL_DAYS,
  registerCustomerWithPassword,
  revokeCustomerToken,
  signInCustomerWithPassword,
  verifyCustomerToken,
} from "@/lib/customer-auth";
import { deleteCustomerAccount } from "@/lib/customer-deletion";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";

async function setCustomerCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
}

/** Email sign-up from the account page. */
export async function registerCustomerAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  if (!email || password.length < 8) redirect("/account?error=register");
  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) redirect("/account?error=register");
  const result = await registerCustomerWithPassword(context.tenantId, email, password, name);
  if (!result.ok)
    redirect(result.error === "exists" ? "/account?error=exists" : "/account?error=register");
  await setCustomerCookie(result.value.token);
  redirect("/account?welcome=1");
}

/** Email sign-in from the account page. */
export async function loginCustomerAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  if (!context) redirect("/account?error=login");
  const result = await signInCustomerWithPassword(context.tenantId, email, password);
  if (!result.ok) redirect("/account?error=login");
  await setCustomerCookie(result.value.token);
  redirect("/account?welcome=1");
}

/** "Konto löschen" from the account page. The confirm checkbox is
 *  `required` in the form; checked again here so a hand-built POST
 *  cannot skip the one step that says this is permanent. */
export async function deleteCustomerAccountAction(formData: FormData): Promise<void> {
  if (formData.get("confirm") !== "yes") redirect("/account?delete=1#konto-loeschen");
  const store = await cookies();
  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  const customer = context
    ? await verifyCustomerToken(context.tenantId, store.get(CUSTOMER_COOKIE)?.value)
    : null;
  if (!context || !customer) redirect("/account?delete=1");
  await deleteCustomerAccount(context.tenantId, customer.id);
  store.set(CUSTOMER_COOKIE, "", { path: "/", maxAge: 0 });
  redirect("/account?deleted=1");
}

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
