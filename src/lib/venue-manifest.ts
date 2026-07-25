import { resolveMenuTheme } from "./menu-themes";

/**
 * Web-app manifest for the guest menu. A guest who taps "Add to Home
 * Screen" gets an icon named after the restaurant that opens straight to
 * the menu at `/` standalone — full screen, no address bar — with the
 * splash and title bar in the venue's chosen menu-theme colours.
 *
 * Pure JSON builder so it can be unit-tested; the route handler at
 * /manifest.webmanifest does the venue lookup and serves this.
 */
export interface VenueManifestInput {
  name: string;
  theme?: string;
  logoKey?: string | null;
}

export function buildVenueManifest(venue: VenueManifestInput) {
  const theme = resolveMenuTheme(venue.theme);
  const base = `/`;
  // Uploaded logos are served resized through the /img proxy; venues
  // without one fall back to the Guesto mark so the manifest always
  // has an installable 192px icon.
  const icons = venue.logoKey
    ? ([192, 512] as const).map((size) => ({
        src: `/img/${encodeURIComponent(venue.logoKey as string)}?w=${size}&fmt=png`,
        sizes: `${size}x${size}`,
        type: "image/png",
      }))
    : [
        { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      ];
  return {
    name: venue.name,
    short_name: venue.name.length > 12 ? venue.name.slice(0, 12).trimEnd() : venue.name,
    start_url: base,
    id: base,
    scope: base,
    display: "standalone" as const,
    background_color: theme.vars.bg,
    theme_color: theme.vars.bg,
    icons,
  };
}
