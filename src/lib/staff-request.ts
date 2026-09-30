import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "./client-ip";
import { withCors } from "./cors";
import { checkRateLimit, STAFF_IP } from "./rate-limit";
import { staffCan, staffFromRequest, type StaffPrincipal } from "./staff-auth";
import type { Permission } from "./team-permissions";

/**
 * The gate every `/api/v1/staff/*` handler opens with: one light per-IP
 * limit, then the restaurant-session check (owner or team member) and the
 * route's team box. Shared so a new staff route can
 * never accidentally ship without either — and so all four answer the
 * same two refusals byte for byte, which is what the app branches on.
 */

export type StaffGate = { ok: true; staff: StaffPrincipal } | { ok: false; response: NextResponse };

/**
 * `area` is the team box this route needs (owner, 2026-09-30): the owner
 * passes every check; a team member only with that box ticked, else a
 * 403 `forbidden` the app shows as "no access". Omitted = any member of
 * this restaurant (push registration, logout-adjacent reads).
 */
export async function requireStaff(
  req: NextRequest,
  area?: Permission | "owner",
): Promise<StaffGate> {
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
  if (area && !staffCan(staff, area)) {
    return {
      ok: false,
      response: withCors(NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 })),
    };
  }
  return { ok: true, staff };
}

/** Orders are never cacheable: the URL carries no identity, and a stale
 *  board is worse than no board. */
export const STAFF_NO_STORE = { "Cache-Control": "private, no-store" } as const;
