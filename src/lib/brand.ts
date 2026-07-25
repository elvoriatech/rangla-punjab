/**
 * White-label brand identity for the app shell (page titles, PWA name,
 * email from-name, console labels). This is the single place a new
 * deployment rebrands the product — set one env var:
 *
 *   NEXT_PUBLIC_APP_BRAND_NAME="Your Brand"
 *
 * It is `NEXT_PUBLIC_` so the value reaches client components (the
 * dashboard rail, admin sidebar, …) as well as the server — a non-public
 * var is `undefined` in the browser bundle and would silently fall back
 * to the default. `APP_BRAND_NAME` stays supported for server-only
 * contexts. Per-restaurant content (menu, venue name, logo) is DB-driven
 * and lives on the tenant/venue, not here.
 */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_APP_BRAND_NAME ?? process.env.APP_BRAND_NAME ?? "Rangla Punjab",
  tagline:
    process.env.NEXT_PUBLIC_APP_BRAND_TAGLINE ??
    process.env.APP_BRAND_TAGLINE ??
    "Order online — fresh from our kitchen, straight to your table.",
} as const;
