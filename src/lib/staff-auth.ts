import type { NextRequest } from "next/server";
import { loginUser } from "./auth-service";
import { verifySessionValue } from "./auth";
import { signSession } from "./session";
import { asTenant } from "./tenant";
import { resolvePreviewContext } from "./preview-context";
import { getRestaurantSlug } from "./restaurant";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * "Is this the restaurant?" for the app's orders board.
 *
 * There are no staff accounts. The ONE restaurant login is the dashboard
 * owner account — the user seeded from `OWNER_EMAIL`/`OWNER_PASSWORD`
 * that holds the `owner` Membership for this deploy's single tenant. The
 * environment is only how that row is first written; every check below
 * reads the DATABASE, so rotating the seed vars never silently grants or
 * revokes access, and pulling the membership locks the app out on the
 * very next request.
 *
 * The credential the app carries is the dashboard's own HMAC-signed
 * session value (`signSession`) rather than a row in a token table: the
 * board is a read-mostly view of data the same person already sees at
 * `/dashboard`, so a second token store would be two revocation stories
 * for one account. Logout is therefore client-side — the app drops the
 * value — and the membership check on every request is what actually
 * revokes.
 *
 * Deliberately NOT interchangeable with the guest credential: a customer
 * token is opaque random bytes with no signature envelope, so
 * `verifySession` rejects it, and a session value hashes to nothing in
 * `customer_tokens`, so `verifyCustomerToken` rejects it too.
 */

export interface StaffPrincipal {
  userId: string;
  tenantId: string;
}

/** The single venue this deploy serves, as (tenantId, venueId). */
async function restaurantContext(): Promise<{ tenantId: string; venueId: string } | null> {
  const context = await resolvePreviewContext(await getRestaurantSlug(), null);
  return context ? { tenantId: context.tenantId, venueId: context.venueId } : null;
}

/** Does this user hold the `owner` membership for this venue's tenant?
 *  Read under the tenant GUC, so RLS is the second pair of eyes on the
 *  `tenantId` we resolved. */
async function isOwnerOf(tenantId: string, userId: string): Promise<boolean> {
  const membership = await asTenant(tenantId, (tx) =>
    tx.membership.findFirst({ where: { userId, role: "owner" }, select: { id: true } }),
  );
  return membership !== null;
}

/**
 * Sign the restaurant in with the SAME email + password form the guests
 * use. Returns null for every failure — a wrong password, a user from
 * another tenant, a user whose owner membership was removed — so the
 * caller can answer one generic error and never leak which kind of
 * account an address belongs to.
 *
 * Callers must try the guest account FIRST: a matching guest wins.
 */
export interface SignedInRestaurant {
  userId: string;
  /** The dashboard session value; the app sends it back as `X-Staff-Token`. */
  token: string;
  name: string;
  email: string;
}

export async function signInRestaurant(
  context: { tenantId: string; venueId: string },
  emailRaw: string,
  password: string,
): Promise<SignedInRestaurant | null> {
  const email = emailRaw.trim();
  const login = await loginUser(email, password);
  if (!login.ok) return null;
  if (!(await isOwnerOf(context.tenantId, login.userId))) {
    // Correct password, but not this restaurant's owner — an employee's
    // dashboard-less account, or an owner of some other deploy's tenant.
    log.warn("staff_auth.not_owner", { userId: login.userId });
    return null;
  }
  const venue = await asTenant(context.tenantId, (tx) =>
    tx.venue.findFirst({ where: { id: context.venueId }, select: { name: true } }),
  );
  log.info("staff_auth.signed_in", { userId: login.userId });
  return {
    userId: login.userId,
    token: signSession(login.userId),
    name: venue?.name ?? "",
    email,
  };
}

/** The header the app sends. Deliberately its own name: a guest bearer
 *  token must never be mistaken for a staff credential. */
export function staffToken(req: NextRequest): string | null {
  return req.headers.get("x-staff-token");
}

/**
 * Who is this request? Verifies the signed session (HMAC + expiry + the
 * `sessions_valid_from` cutoff a password reset bumps), then re-checks
 * the owner membership — per request, so revocation is immediate.
 */
export async function staffFromRequest(req: NextRequest): Promise<StaffPrincipal | null> {
  const token = staffToken(req);
  if (!token) return null;
  const session = await verifySessionValue(token);
  if (!session) return null;
  const context = await restaurantContext();
  if (!context) return null;
  if (!(await isOwnerOf(context.tenantId, session.userId))) return null;
  return { userId: session.userId, tenantId: context.tenantId };
}
