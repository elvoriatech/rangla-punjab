import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { checkRateLimit, STAFF_IP } from "@/lib/rate-limit";

/**
 * POST /api/v1/staff/logout — an acknowledgement, not a revocation.
 *
 * The restaurant credential is a self-contained signed session value, so
 * "logging out" is the app deleting it; there is no row to strike. The
 * endpoint exists anyway because the client wants one call to make on
 * sign-out, and because it keeps the door open for a server-side
 * revocation later without an app release.
 *
 * Deliberately answers 200 whatever it is handed — including an expired
 * or absent token. Signing out must never strand the app on an error
 * screen, and there is nothing here to protect: the handler reads no
 * data and writes none.
 *
 * What DOES revoke, immediately and server-side: removing the owner
 * membership (re-checked on every staff request) or a password reset,
 * which bumps `sessions_valid_from` and kills every outstanding session
 * value at once.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate limited like the rest of `/api/v1/staff/*` purely so an open
  // endpoint cannot be used to mint Redis keys for free.
  const rl = await checkRateLimit(STAFF_IP, clientIp(req));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }
  return withCors(NextResponse.json({ ok: true }));
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
