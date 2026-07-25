import { cookies } from "next/headers";
import { asUser } from "./tenant";

/**
 * Active-branch (venue) selection for the dashboard. One tenant may own
 * several venues (branches); the owner picks which one the dashboard is
 * currently managing. The choice rides in a first-party cookie (the
 * dashboard is authenticated, so a cookie is fine here — unlike the
 * zero-cookie public menu).
 *
 * Resolution is defensive: an unknown/foreign venue id in the cookie
 * (stale, tampered, or from another tenant) falls back to the oldest
 * venue, and `cookies()` failing outside a request scope (unit tests that
 * call venue services directly) also falls back — so callers always get a
 * real venue the user owns, or null when they have none.
 */

const COOKIE = "rp_active_venue";

export interface OwnerVenue {
  id: string;
  name: string;
}

/** Every non-deleted venue the user's tenant owns, oldest first. */
export async function listOwnerVenues(userId: string): Promise<OwnerVenue[]> {
  return asUser(userId, (tx) =>
    tx.venue.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  );
}

/**
 * The venue the dashboard is currently managing: the cookie's choice when
 * it names a venue the tenant owns, else the oldest venue, else null.
 */
export async function getActiveVenueId(userId: string): Promise<string | null> {
  const venues = await listOwnerVenues(userId);
  if (venues.length === 0) return null;

  let wanted: string | undefined;
  try {
    wanted = (await cookies()).get(COOKIE)?.value;
  } catch {
    // No request scope (e.g. a unit test calling a venue service directly).
  }
  if (wanted && venues.some((v) => v.id === wanted)) return wanted;
  return venues[0]!.id;
}

export const ACTIVE_VENUE_COOKIE = COOKIE;
