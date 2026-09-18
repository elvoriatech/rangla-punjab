/**
 * The ONE locale registry. Everything that needs to know which languages
 * exist — venue settings, `<html lang dir>`, the CDN cache-header regex,
 * the footer switcher, the guest-copy catalogues, the mobile picker — reads
 * this file. It has no imports so `next.config.ts` can load it too.
 *
 * Two tiers:
 *   - every entry is a valid VENUE locale: owners may enable it, guests may
 *     route to /{code}, dish translations may exist for it.
 *   - `ui: true` marks the locales that also have a full guest-copy
 *     catalogue (buttons, labels, emails, receipt). A venue locale without
 *     one shows dish text in that language and chrome in English.
 *
 * Order matters: `updateVenueLocalization` sorts `enabledLocales` to this
 * order for a stable settings UI, and tests pin it.
 */
export const LOCALES = [
  { code: "en", label: "English", flag: "🇬🇧", dir: "ltr", ui: true },
  { code: "de", label: "Deutsch", flag: "🇩🇪", dir: "ltr", ui: true },
  { code: "fr", label: "Français", flag: "🇫🇷", dir: "ltr", ui: false },
  { code: "it", label: "Italiano", flag: "🇮🇹", dir: "ltr", ui: true },
  { code: "es", label: "Español", flag: "🇪🇸", dir: "ltr", ui: true },
  { code: "nl", label: "Nederlands", flag: "🇳🇱", dir: "ltr", ui: false },
  { code: "pl", label: "Polski", flag: "🇵🇱", dir: "ltr", ui: false },
  { code: "pt", label: "Português", flag: "🇵🇹", dir: "ltr", ui: false },
  { code: "tr", label: "Türkçe", flag: "🇹🇷", dir: "ltr", ui: false },
  { code: "ar", label: "العربية", flag: "🇸🇦", dir: "rtl", ui: true },
] as const;

export type LocaleEntry = (typeof LOCALES)[number];
export type LocaleCode = LocaleEntry["code"];
/** Locales with a complete guest-copy catalogue. */
export type UiLocale = Extract<LocaleEntry, { ui: true }>["code"];

export const LOCALE_CODES = LOCALES.map((l) => l.code) as readonly LocaleCode[];
export const UI_LOCALES = LOCALES.filter((l) => l.ui).map((l) => l.code) as readonly UiLocale[];

/** Alternation for route matchers, e.g. the cache-header rule in next.config. */
export const LOCALE_PATH_PATTERN = LOCALE_CODES.join("|");

/** Right-to-left scripts. `he`/`fa`/`ur` are listed so adding them later is
 *  a one-line change to LOCALES, not a hunt through the codebase. */
export const RTL_LOCALES: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

export function isLocaleCode(x: unknown): x is LocaleCode {
  return typeof x === "string" && (LOCALE_CODES as readonly string[]).includes(x);
}

export function localeEntry(code: string): LocaleEntry | undefined {
  return LOCALES.find((l) => l.code === code);
}

/** Text direction for `<html dir>` / `I18nManager`. Works on region tags
 *  ("ar-EG") and unknown codes (→ ltr). */
export function dirFor(code: string | null | undefined): "ltr" | "rtl" {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return RTL_LOCALES.has(base) ? "rtl" : "ltr";
}

export function isRtl(code: string | null | undefined): boolean {
  return dirFor(code) === "rtl";
}

/**
 * Which guest-copy catalogue to use for a venue/route locale. Region tags
 * collapse to their language ("de-DE" → "de", "en-GB" → "en"); venue
 * locales without a catalogue (fr, nl, …) and anything unknown fall back to
 * English, which is the only catalogue guaranteed complete.
 */
export function uiLocale(code: string | null | undefined): UiLocale {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return (UI_LOCALES as readonly string[]).includes(base) ? (base as UiLocale) : "en";
}
