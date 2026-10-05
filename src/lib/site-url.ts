import { env } from "./env";
import { uploadedImageUrl } from "./menu-images";

/**
 * Absolute public origin of the app, no trailing slash. Set `APP_URL` in
 * the environment when deploying — every guest-facing absolute URL (QR
 * codes, receipts, JSON-LD, emails, dashboard copy) derives from here so
 * the domain lives in exactly one place.
 */
export function siteUrl(): string {
  return env.APP_URL.replace(/\/+$/, "");
}

/** Origin without the protocol — for human-facing copy ("menu lives at …"). */
export function siteHost(): string {
  return siteUrl().replace(/^https?:\/\//, "");
}

/** Open Graph image block for a stored upload — the venue's banner is
 *  what a shared link and a search result's thumbnail should show. Empty
 *  when there is no banner, so the spread adds nothing. */
export function shareImage(storageKey: string | null | undefined): {
  images?: { url: string }[];
} {
  return storageKey
    ? { images: [{ url: `${siteUrl()}${uploadedImageUrl(storageKey, 1280)}` }] }
    : {};
}
