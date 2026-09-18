import { cache } from "react";
import { prisma } from "./db";

/**
 * Single-restaurant deploy: this build serves exactly one restaurant, so
 * the venue slug never appears in a URL — the public menu lives at `/`.
 * Code that still needs the slug internally (the slug→venue resolver,
 * the order POST body, per-venue manifest) reads it from here.
 *
 * `RESTAURANT_SLUG` in the environment wins when set (deterministic, no DB
 * hit); otherwise we fall back to the primary (oldest) active venue in the
 * DB. Wrapped in React `cache` so every consumer in a request shares one
 * lookup.
 */
export const getRestaurantSlug = cache(async (): Promise<string> => {
  const fromEnv = process.env.RESTAURANT_SLUG?.trim();
  if (fromEnv) return fromEnv;

  const venue = await prisma.venue.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });
  if (!venue) throw new Error("no venue provisioned — run scripts/seed-restaurant.ts");
  return venue.slug;
});

/** What the sign-in screen needs to look like this restaurant rather than
 *  like the product: the venue's display name and its published menu
 *  branding. Deliberately NOT `loadPublicMenu` — that pulls every category,
 *  item, variant and translation to render a page that shows none of them. */
export interface RestaurantIdentity {
  name: string;
  logoKey: string | null;
  theme?: string;
  texture?: string;
  backdrop?: string;
  headingColor?: string;
}

/**
 * Read the single restaurant's name + branding. Returns null rather than
 * throwing when no venue exists yet: a fresh deploy that has not been
 * seeded must still be able to render a login form, or the owner cannot
 * get in to fix it.
 */
export const getRestaurantIdentity = cache(async (): Promise<RestaurantIdentity | null> => {
  const venue = await prisma.venue.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { name: true, branding: true },
  });
  if (!venue) return null;

  const b = (venue.branding ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  return {
    name: venue.name,
    logoKey: typeof b.logoKey === "string" && b.logoKey ? b.logoKey : null,
    theme: str(b.theme),
    texture: str(b.texture),
    backdrop: str(b.backdrop),
    headingColor: str(b.headingColor),
  };
});
