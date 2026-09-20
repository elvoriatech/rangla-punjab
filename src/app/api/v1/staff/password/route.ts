import { NextResponse, type NextRequest } from "next/server";
import { changeUserPassword, OWNER_PASSWORD_MIN_LENGTH } from "@/lib/auth-service";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { checkRateLimit, PASSWORD_CHANGE_IP } from "@/lib/rate-limit";
import { signSession } from "@/lib/session";
import { requireStaff, STAFF_NO_STORE } from "@/lib/staff-request";

/**
 * POST /api/v1/staff/password  { currentPassword, newPassword, confirmPassword? }
 *   → 200 { ok: true, token }
 *   → 400 { ok: false, error: "wrong_password" | "mismatch" | "too_short" |
 *                             "same_as_current" | "invalid", minLength }
 *
 * "Change my password", from behind the counter — the app's half of the
 * dashboard's Settings card, over the same `changeUserPassword`.
 *
 * Two things here are deliberate and easy to get wrong:
 *
 * 1. A WRONG CURRENT PASSWORD IS 400, NEVER 401/403. The app maps 401 to
 *    "this session is gone" and drops the staff token — so answering a
 *    mistyped password with 401 would sign the counter's tablet out
 *    mid-service. 401 here keeps its one meaning: the token is no good.
 *
 * 2. A SUCCESS RETURNS A NEW TOKEN. The staff credential IS a signed
 *    session value (`staff-auth.ts`), and a change bumps
 *    `sessions_valid_from`, which kills every value issued before it —
 *    including the one this request arrived with. The fresh token is
 *    minted after the write, so this device stays signed in while every
 *    OTHER one is signed out. The app swaps it into its secure store.
 *
 * Rate limited twice over: `requireStaff` applies the board's generous
 * per-IP poll ceiling, and `PASSWORD_CHANGE_IP` adds the tight one this
 * route actually needs — the body carries a guessable secret.
 */

type Refusal = "wrong_password" | "mismatch" | "too_short" | "same_as_current" | "invalid";

function refuse(error: Refusal): NextResponse {
  return withCors(
    NextResponse.json(
      { ok: false, error, minLength: OWNER_PASSWORD_MIN_LENGTH },
      { status: 400, headers: STAFF_NO_STORE },
    ),
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireStaff(req);
  if (!gate.ok) return gate.response;

  const rl = await checkRateLimit(PASSWORD_CHANGE_IP, clientIp(req));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { ...STAFF_NO_STORE, "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse("invalid");
  const raw = body as Record<string, unknown>;

  const currentPassword = raw.currentPassword;
  const newPassword = raw.newPassword;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return refuse("invalid");
  }
  // Optional: a client with only two boxes sends two. Anything that is
  // present but not a string is a broken client, not a mismatch.
  if (raw.confirmPassword !== undefined && typeof raw.confirmPassword !== "string") {
    return refuse("invalid");
  }

  const result = await changeUserPassword(gate.staff.userId, {
    currentPassword,
    newPassword,
    ...(raw.confirmPassword === undefined ? {} : { confirmPassword: raw.confirmPassword }),
  });
  if (!result.ok) return refuse(result.error);

  return withCors(
    NextResponse.json(
      { ok: true, token: signSession(gate.staff.userId) },
      { headers: STAFF_NO_STORE },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
