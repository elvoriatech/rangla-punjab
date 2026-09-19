import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "./client-ip";
import { withCors } from "./cors";
import { checkRateLimit, STAFF_IP } from "./rate-limit";
import { staffFromRequest, type StaffPrincipal } from "./staff-auth";

/**
 * The gate every `/api/v1/staff/*` handler opens with: one light per-IP
 * limit, then the owner-session check. Shared so a new staff route can
 * never accidentally ship without either — and so all four answer the
 * same two refusals byte for byte, which is what the app branches on.
 */

export type StaffGate = { ok: true; staff: StaffPrincipal } | { ok: false; response: NextResponse };

export async function requireStaff(req: NextRequest): Promise<StaffGate> {
  const rl = await checkRateLimit(STAFF_IP, clientIp(req));
  if (!rl.ok) {
    return {
      ok: false,
      response: withCors(
        NextResponse.json(
          { ok: false, error: "rate_limited" },
          { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
        ),
      ),
    };
  }

  const staff = await staffFromRequest(req);
  if (!staff) {
    return {
      ok: false,
      response: withCors(NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })),
    };
  }
  return { ok: true, staff };
}

/** Orders are never cacheable: the URL carries no identity, and a stale
 *  board is worse than no board. */
export const STAFF_NO_STORE = { "Cache-Control": "private, no-store" } as const;
