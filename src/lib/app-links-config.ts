import { z } from "zod";

/**
 * Where a guest gets the restaurant's own app — the "App" card in
 * Dashboard → Settings, stored in `venues.app_links` JSONB.
 *
 * Three slots, no more: the iOS listing (`apps.apple.com`), the Android
 * listing (`play.google.com`) and a DIRECT `.apk` the owner hosts
 * themselves. The third exists because a venue that has not paid for a
 * Play Console listing — or is waiting on review — still has a signed
 * build it wants on a regular's phone, and a QR menu is the only place a
 * guest will ever look for it.
 *
 * Every slot is a plain `https://` URL string or null. Stored as the owner
 * typed it, minus whitespace and after `new URL()` has agreed it parses:
 * nothing about a store link is derivable, so unlike `contact-config.ts`
 * there is no normalisation to do beyond "is this actually a link".
 *
 * Same tolerant posture as `contact-config.ts` / `loyalty-config.ts`: a
 * half-filled or hand-edited blob must never fail the whole parse, because
 * a venue whose app JSON throws would lose its MENU, not just its download
 * buttons. Anything unreadable in a slot reads back as `null` — "not
 * published" — which every surface already renders as nothing at all.
 */

/** The three slots, in the order every surface renders them. */
export const APP_LINK_FIELDS = ["ios", "android", "apk"] as const;
export type AppLinkField = (typeof APP_LINK_FIELDS)[number];

/**
 * Longest URL any slot will hold. Store links are short; 500 is well past
 * a Play listing with campaign parameters and short of anything that looks
 * like someone pasting a document into the box.
 */
export const MAX_APP_LINK_LENGTH = 500;

/** The one host an iOS listing lives on. Apple redirects `itunes.apple.com`
 *  to it, but an owner who pastes the old host gets told so rather than
 *  having a link published that depends on a redirect Apple owns. */
export const IOS_HOST = "apps.apple.com";
/** Likewise for Android. `market://` deep links are deliberately NOT
 *  accepted: they do nothing in a desktop browser, and the https listing
 *  opens the Play app on a phone anyway. */
export const ANDROID_HOST = "play.google.com";

/**
 * Whatever the owner typed → a URL we are willing to publish, or null.
 *
 * `https:` only, for all three: a menu page is served over TLS and an
 * `http://` download button is both a mixed-content block and, for the APK
 * case, a genuinely dangerous thing to put in front of a guest. Embedded
 * credentials (`https://user:pw@…`) are refused for the same reason — that
 * is never a store link, and it is a classic phishing shape.
 *
 * The store slots additionally insist on their own host, because the whole
 * value of an official-looking badge is that it goes where it says it goes.
 * The APK slot takes ANY https URL: the owner hosts that file themselves,
 * on a domain only they know.
 */
export function normalizeAppLink(raw: unknown, field: AppLinkField): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_APP_LINK_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;

  const host = url.hostname.toLowerCase();
  if (field === "ios" && host !== IOS_HOST) return null;
  if (field === "android" && host !== ANDROID_HOST) return null;

  // `URL` lower-cases the host and fills in an empty path, so what we store
  // is one canonical spelling of the link rather than whatever casing the
  // owner's clipboard carried.
  const href = url.toString();
  return href.length <= MAX_APP_LINK_LENGTH ? href : null;
}

/** One slot: an https URL, or null for "not published". Tolerant — a value
 *  that is not a usable link becomes null instead of failing the whole
 *  config. */
const linkField = (field: AppLinkField): z.ZodType<string | null> =>
  z.preprocess((v) => normalizeAppLink(v, field), z.string().nullable().catch(null));

export const appLinksConfigSchema = z.object({
  ios: linkField("ios").default(null),
  android: linkField("android").default(null),
  apk: linkField("apk").default(null),
});

export type AppLinksConfig = z.infer<typeof appLinksConfigSchema>;

/** Never throws. `{}`, null, a string, a half-written object — all of them
 *  parse to "no app published". */
export function parseAppLinksConfig(raw: unknown): AppLinksConfig {
  const parsed = appLinksConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ios: null, android: null, apk: null };
}

/** True when nothing is published — the whole feature renders nowhere. */
export function appLinksEmpty(config: AppLinksConfig): boolean {
  return APP_LINK_FIELDS.every((f) => config[f] === null);
}

/**
 * The public projection every guest surface gets — the web menu footer and
 * header, `/api/v1/menu`.
 *
 * Keys are OMITTED rather than null when a slot is empty, so a client can
 * write `if (appLinks?.ios)` and a JSON payload does not carry three nulls
 * for the overwhelmingly common "no app at all" venue. The whole object is
 * null in that case, which is the single check every surface makes before
 * rendering any of this.
 */
export interface PublicAppLinks {
  ios?: string;
  android?: string;
  apk?: string;
}

export function publicAppLinks(config: AppLinksConfig): PublicAppLinks | null {
  if (appLinksEmpty(config)) return null;
  const out: PublicAppLinks = {};
  if (config.ios !== null) out.ios = config.ios;
  if (config.android !== null) out.android = config.android;
  if (config.apk !== null) out.apk = config.apk;
  return out;
}
