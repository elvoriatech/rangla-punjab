import { env } from "./env";

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
