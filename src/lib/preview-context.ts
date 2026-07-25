import { prisma } from "./db";
import { asTenant } from "./tenant";
import { verifyPreviewToken } from "./preview-token";

/**
 * Seam consumed by the public `/r/[slug]` route (and, from P1-10 onwards,
 * the real menu renderer). Given the slug + optional preview token, this
 * returns which menu version to render, or `null` when the request is
 * bogus (invalid token, wrong venue, unknown slug).
 *
 * Public reads normally can't cross RLS without a tenant GUC. The preview
 * path is a fine exception: the token's signature *is* the auth, and the
 * token carries the tenantId we need to set the GUC. For the non-preview
 * path we resolve the venue via a lightweight raw query that is
 * intentionally scoped to slug-only public columns; when P1-10 arrives it
 * will replace this stub with a fuller published-menu read.
 */

export type PreviewContext =
  | {
      mode: "preview";
      venueId: string;
      tenantId: string;
      draftVersionId: string | null;
    }
  | {
      mode: "public";
      venueId: string;
      tenantId: string;
      publishedVersionId: string | null;
    };

export async function resolvePreviewContext(
  slug: string,
  token: string | null,
): Promise<PreviewContext | null> {
  if (token) {
    const parsed = verifyPreviewToken(token);
    if (!parsed) return null;
    return asTenant(parsed.tenantId, async (tx) => {
      const venue = await tx.venue.findFirst({
        where: { id: parsed.venueId, slug, deletedAt: null },
        select: { id: true, tenantId: true },
      });
      if (!venue) return null; // token venue/slug mismatch → 404
      const draft = await tx.menuVersion.findFirst({
        where: { status: "draft", menu: { venueId: venue.id } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      // No unsaved draft (e.g. right after provisioning, or after a
      // publish) ⇒ the "draft" the owner is previewing IS the live menu.
      // Fall back to the published pointer so the preview renders the
      // current menu instead of 404ing on a missing draft.
      const published = draft
        ? null
        : await tx.menu.findFirst({
            where: { venueId: venue.id },
            select: { publishedVersion: true },
          });
      return {
        mode: "preview",
        venueId: venue.id,
        tenantId: venue.tenantId,
        draftVersionId: draft?.id ?? published?.publishedVersion ?? null,
      };
    });
  }

  // Public path — no token. Slug → (venueId, tenantId) via the
  // SECURITY DEFINER `resolve_public_venue` (narrow RLS bypass, granted
  // to the app role only). Once we have the tenantId we set the GUC and
  // read the published pointer under normal RLS.
  const rows = await prisma.$queryRaw<{ venue_id: string; tenant_id: string }[]>`
    SELECT * FROM resolve_public_venue(${slug})
  `;
  const row = rows[0];
  if (!row) return null;
  const published = await asTenant(row.tenant_id, async (tx) => {
    return tx.menu.findFirst({
      where: { venueId: row.venue_id },
      select: { publishedVersion: true },
    });
  });
  return {
    mode: "public",
    venueId: row.venue_id,
    tenantId: row.tenant_id,
    publishedVersionId: published?.publishedVersion ?? null,
  };
}
