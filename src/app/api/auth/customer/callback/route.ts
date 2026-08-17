import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_TOKEN_TTL_DAYS,
  customerProviders,
  exchangeCode,
  signInCustomer,
  verifyState,
} from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { redis } from "@/lib/redis";
import { siteUrl } from "@/lib/site-url";

/**
 * OIDC callback for every provider (which one rides in the signed state).
 * Exchanges the code, upserts the customer, mints the opaque token, sets
 * the web cookie — and, when the flow started on the APP (device code in
 * the state), parks the token in Redis for the app's poll to collect.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const back = (path: string): NextResponse => NextResponse.redirect(`${siteUrl()}${path}`, 303);

  const state = verifyState(req.nextUrl.searchParams.get("state") ?? "");
  const code = req.nextUrl.searchParams.get("code");
  if (!state || !code) return back("/account?error=login");

  const provider = customerProviders().find((p) => p.id === state.p);
  if (!provider) return back("/account?error=login");

  const identity = await exchangeCode(provider, code);
  if (!identity) return back("/account?error=login");

  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  if (!context) return back("/account?error=login");

  const signedIn = await signInCustomer(context.tenantId, provider.id, identity);

  // App-initiated flow: hand the token to the polling device code.
  if (state.d && /^[a-z0-9-]{4,40}$/i.test(state.d)) {
    await redis.set(
      `customer-device:${state.d}`,
      JSON.stringify({
        status: "ok",
        token: signedIn.token,
        customer: { email: signedIn.email, name: signedIn.name },
      }),
      "EX",
      600,
    );
  }

  const store = await cookies();
  store.set(CUSTOMER_COOKIE, signedIn.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
  return back(state.d ? "/account?welcome=1&app=1" : "/account?welcome=1");
}
