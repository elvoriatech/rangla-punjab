import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Injects the current pathname into the request headers so the root
 * layout can read it via `next/headers` and set `<html lang>` per route.
 * Without this hop, `RootLayout` has no access to the URL and every
 * route would render under the default `en`.
 *
 * P2-1 also mints an `x-request-id` per ingress (uuidv4, or reuses one
 * an upstream proxy already set) and echoes it on the response so any
 * log line inside a request can be traced back to a single client
 * event. Route handlers read the header via `next/headers` and wrap
 * their bodies in `runWithRequestContext` from `src/lib/logger.ts`.
 *
 * The exclusion list keeps static assets out of the middleware so we
 * don't force Next to run per-image or per-font. Everything user-facing
 * still passes through.
 */
export function middleware(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  headers.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
