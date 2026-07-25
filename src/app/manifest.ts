import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/**
 * Web-app manifest for the operator side (dashboard + kitchen). Makes
 * the site installable — "Add to Home Screen" on a phone or kitchen
 * tablet launches it standalone: full screen, no browser chrome, with
 * normal in-app navigation. start_url goes through the legacy
 * /dashboard stub, which resolves the signed-in owner's venue and
 * forwards to /restaurant/{slug} (or onboarding/login when there is
 * none) — so one manifest serves every tenant.
 *
 * Guest menus get their own per-venue manifest with the restaurant's
 * name, logo, and theme colours (src/app/r/[slug]/manifest.webmanifest).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: `${BRAND.name} — dashboard and kitchen screen.`,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1c130b",
    theme_color: "#1c130b",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
