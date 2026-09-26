import type { AppLinksConfig } from "./app-links-config";

/**
 * The printed "get the app" QR code — one code for every phone.
 *
 * The code encodes `/app`, a URL that never changes. What it resolves to
 * is decided per request from the scanning phone's User-Agent and the
 * links the owner has saved in Dashboard → Settings → App:
 *
 *   iPhone / iPad + App Store link saved  → the App Store listing
 *   Android      + Google Play link saved → the Play listing
 *   anything else                          → the `/app/download` page
 *
 * So a brochure printed today, while a store is still "coming soon", starts
 * sending phones to that store the moment the owner pastes its link — no
 * reprint, no deploy.
 *
 * Server-side on purpose: a printed code has to work on every phone, with
 * or without JavaScript, and a redirect costs the guest no page load.
 */

export type AppPlatform = "ios" | "android" | "other";

/** Path the QR encodes. Short, because a shorter URL is a less dense code
 *  that scans more reliably at brochure size. */
export const APP_DOWNLOAD_PATH = "/app";
/** The fallback page: "coming soon" + order online, or both badges. */
export const APP_DOWNLOAD_PAGE = "/app/download";

/**
 * Which store a User-Agent belongs to.
 *
 * Android is checked first: some Android browsers mention "like iPhone"-
 * shaped tokens, never the reverse. An iPad on iPadOS 13+ in its default
 * "desktop" mode sends a Mac User-Agent and reads as "other" — it lands on
 * the page, where the App Store badge is one tap away.
 */
export function detectPlatform(userAgent: string | null | undefined): AppPlatform {
  const ua = userAgent ?? "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "other";
}

/** The store URL to send this phone to, or null to show the page. The
 *  direct `.apk` slot is deliberately never a redirect target: a printed
 *  code that silently downloads an installer is the wrong promise. */
export function appStoreTarget(platform: AppPlatform, links: AppLinksConfig): string | null {
  if (platform === "ios") return links.ios;
  if (platform === "android") return links.android;
  return null;
}
