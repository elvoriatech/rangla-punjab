import { NextRequest, NextResponse } from "next/server";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_TOKEN_TTL_DAYS,
  customerProviders,
  exchangeCode,
  signInCustomer,
  verifyState,
} from "@/lib/customer-auth";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { redis } from "@/lib/redis";
import { siteUrl } from "@/lib/site-url";

/**
 * OIDC callback for every provider (which one rides in the signed state).
 * Exchanges the code, upserts the customer, mints the opaque token, sets
 * the web cookie — and, when the flow started on the APP (device code in
 * the state), parks the token in Redis for the app's poll to collect.
 *
 * The app also parks its own return deep link with the device code, so a
 * browser sign-in ENDS in the app: we bounce to `/auth/app-return`, which
 * hands the browser over to the deep link. The link is looked up from the
 * code — it never travels through the provider in the OAuth state — and
 * only ever reaches the page after `sanitizeAppReturnUrl`. Without one
 * (older builds, or a link we refuse) the flow keeps landing on /account.
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
  let appReturnUrl: string | null = null;
  if (state.d && /^[a-z0-9-]{4,40}$/i.test(state.d)) {
    appReturnUrl = await storedAppReturn(state.d);
    await redis.set(
      `customer-device:${state.d}`,
      // The full profile, identical to what POST /api/auth/customer/google
      // and GET /api/v1/me return — the app prefills checkout from it and
      // must not care which sign-in route it came through. A superset of
      // the old {email, name}, so older builds keep working.
      JSON.stringify({ status: "ok", token: signedIn.token, customer: signedIn.customer }),
      "EX",
      600,
    );
  }

  // The app is waiting on the other side of this deep link: send the
  // browser to the hand-over page rather than to a web account screen the
  // guest would have to escape by hand.
  const res = back(
    appReturnUrl
      ? `/auth/app-return?to=${encodeURIComponent(appReturnUrl)}`
      : state.d
        ? "/account?welcome=1&app=1"
        : "/account?welcome=1",
  );
  // Set on the RESPONSE, not through `cookies()`: same Set-Cookie header
  // on the same 303, without tying the handler to a request store.
  res.cookies.set(CUSTOMER_COOKIE, signedIn.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
  return res;
}

/** The return deep link the app parked with its device code, if any.
 *  Re-sanitized on the way out: what Redis holds is only as trustworthy
 *  as whatever wrote it. */
async function storedAppReturn(code: string): Promise<string | null> {
  try {
    const raw = await redis.get(`customer-device:${code}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { app?: unknown };
    return sanitizeAppReturnUrl(typeof entry.app === "string" ? entry.app : null);
  } catch {
    return null;
  }
}
