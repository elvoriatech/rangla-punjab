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
