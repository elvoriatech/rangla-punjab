import { cookies } from "next/headers";
import { prisma } from "./db";
import { signSession, verifySession } from "./session";

/**
 * Cookie plumbing for the signed session. Reading is safe from Server
 * Components; writing (`setSessionCookie`, `clearSessionCookie`) is only
 * legal from a Server Function or Route Handler (Next.js constraint — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).
 */

export const SESSION_COOKIE = "rangla_session";

const COOKIE_OPTIONS = {
  httpOnly: true,
  // Lax lets the cookie ride top-level navigations (e.g. verification-email
  // links) while still refusing cross-site POSTs — the CSRF surface for a
  // GET-safe app is small enough to make Strict feel like paranoia here.
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const parsed = verifySession(raw);
  if (!parsed) return null;

  // Session-cutoff check: password reset (P1-2b) bumps `sessions_valid_from`
  // so cookies issued before that instant are dead even though their HMAC
  // and expiry are still valid.
  const user = await prisma.user.findFirst({
    where: { id: parsed.userId, deletedAt: null },
    select: { sessionsValidFrom: true },
  });
  if (!user) return null;
  if (issuedBeforeCutoff(parsed.issuedAt, user.sessionsValidFrom)) return null;
  return parsed.userId;
}

/** The token's `iat` has whole-second precision, but `sessions_valid_from`
 *  is a millisecond timestamp — and for a brand-new user it is stamped
 *  milliseconds BEFORE signup signs the first cookie. Comparing raw
 *  killed every session issued in the same second as the user row
 *  (signup → instant logout). Floor the cutoff to seconds to match the
 *  token's precision. */
function issuedBeforeCutoff(issuedAt: Date, validFrom: Date): boolean {
  const validFromSec = Math.floor(validFrom.getTime() / 1000) * 1000;
  return issuedAt.getTime() < validFromSec;
}

export async function setSessionCookie(userId: string, ttlSeconds?: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(userId, ttlSeconds), {
    ...COOKIE_OPTIONS,
    maxAge: ttlSeconds ?? 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export interface SessionInfo {
  userId: string;
  /** Platform admin viewing as this user, when impersonating. */
  impersonatorId: string | null;
}

/** Like getSessionUserId, but also exposes the impersonation claim so
 *  the dashboard can show the "viewing as" banner + exit. */
export async function getSessionInfo(): Promise<SessionInfo | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const parsed = verifySession(raw);
  if (!parsed) return null;
  const user = await prisma.user.findFirst({
    where: { id: parsed.userId, deletedAt: null },
    select: { sessionsValidFrom: true },
  });
  if (!user) return null;
  if (issuedBeforeCutoff(parsed.issuedAt, user.sessionsValidFrom)) return null;
  return { userId: parsed.userId, impersonatorId: parsed.impersonatorId };
}

const IMPERSONATION_TTL_SECONDS = 30 * 60;

/** Time-boxed impersonation session: 30 minutes, carries the admin's
 *  identity in the signed claim so exit can restore it and every
 *  surface can show the banner. Server Function-only, like all cookie
 *  writers. */
export async function setImpersonationCookie(
  ownerUserId: string,
  adminUserId: string,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(ownerUserId, IMPERSONATION_TTL_SECONDS, adminUserId), {
    ...COOKIE_OPTIONS,
    maxAge: IMPERSONATION_TTL_SECONDS,
  });
}
