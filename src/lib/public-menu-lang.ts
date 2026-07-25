import { cache } from "react";
import { prisma } from "./db";
import { asTenant } from "./tenant";

/**
 * Default language of a venue's public menu, for `<html lang>` on the
 * locale-less `/r/{slug}` route. A German menu wrongly tagged lang="en"
 * invites Chrome's auto-translate to rewrite the DOM under React's feet
 * (hydration mismatch) and misleads screen readers.
 *
 * Wrapped in React `cache` so layout and page share one lookup per
 * request. Resolution reuses the narrow SECURITY DEFINER seam
 * (`resolve_public_venue`) and then reads under normal RLS.
 */
export const publicMenuDefaultLocale = cache(async (slug: string): Promise<string | null> => {
  try {
    const rows = await prisma.$queryRaw<{ venue_id: string; tenant_id: string }[]>`
      SELECT * FROM resolve_public_venue(${slug})
    `;
    const row = rows[0];
    if (!row) return null;
    const venue = await asTenant(row.tenant_id, (tx) =>
      tx.venue.findFirst({
        where: { id: row.venue_id, deletedAt: null },
        select: { defaultLocale: true },
      }),
    );
    return venue?.defaultLocale ?? null;
  } catch {
    // The layout must never 500 over a lang hint.
    return null;
  }
});
