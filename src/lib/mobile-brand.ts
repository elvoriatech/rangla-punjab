/**
 * Derives the native app's brand — palette, Expo config, identifiers — from
 * a venue's own branding row, so the mobile app is white-label rather than
 * hand-painted for one restaurant.
 *
 * The single input that matters is the venue's menu theme (`branding.theme`),
 * the same value the public web menu renders with. Everything the app needs
 * is solved from that theme's colors, under the contrast constraints the app
 * actually imposes on its tokens:
 *
 *   - `red` is BOTH the header/chrome ground (carrying `onRed` text) AND a
 *     text color on the page (dish prices, "See all" actions) → it must
 *     clear AA on the page and card grounds, and carry `onRed` at AA.
 *   - `goldSoft` is BOTH text on the header ground AND the primary CTA fill
 *     whose label is `ink` → it must clear AA against `red` and against `ink`.
 *   - `ink` / `inkSoft` are page text on `cream` and `creamCard`.
 *   - `positive` / `danger` are status text on cards.
 *
 * Rather than trust a theme's palette to satisfy those pairings, each token
 * is walked along its lightness axis (hue and saturation held) until every
 * pairing it participates in clears WCAG AA — the same `nearestPassingColor`
 * machinery the menu appearance picker uses. mobile-brand.test.ts asserts the
 * full constraint set for every theme we ship, so adding a theme can never
 * hand the app an unreadable palette.
 *
 * Pure module — no fs, no DB, no sharp — so it can be unit-tested and so
 * `scripts/brand-mobile.ts` stays a thin IO shell around it.
 */

import { contrastRatio, hexToRgb, nearestPassingColor, type ContrastLevel } from "./contrast";
import { dangerFor, onColorFor, resolveMenuTheme, type MenuTheme } from "./menu-themes";

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;
/**
 * Contrast the chrome ground holds against the page. AAA (7:1) rather than AA
 * on purpose: the chrome carries the accent as text, and the darker the
 * chrome, the more of the accent's own hue survives that pairing.
 */
const CHROME_ON_PAGE = 7;

/** Exactly the token set `mobile/src/theme.ts` exposes to the screens. */
export interface MobileColors {
  red: string;
  redDark: string;
  cream: string;
  creamCard: string;
  gold: string;
  goldSoft: string;
  ink: string;
  inkSoft: string;
  line: string;
  onRed: string;
  positive: string;
  danger: string;
}

export interface MobileBrandInput {
  /**
   * Venue display name, in full — e.g. "Rangla Punjab Restaurant · Konstanz".
   * Kept verbatim as `venue.name` (the app splits it into two lines itself);
   * the launcher label is shortened from it by `launcherName`.
   */
  name: string;
  /** Venue slug — seeds the Expo slug, deep-link scheme and bundle ids. */
  slug: string;
  /** `branding.theme`; unknown/absent falls back to the default menu theme. */
  themeId?: string | null;
  /** `branding.logoKey`; null means the script paints an initials monogram. */
  logoKey?: string | null;
  /** `branding.bannerKey` — first choice for the hero artwork. */
  bannerKey?: string | null;
  /** `branding.backdrop` — the hero falls back to this menu backdrop's image. */
  backdropId?: string | null;
  /**
   * `branding.halalFilter === "on"` — the venue advertises its kitchen as
   * halal. Not a colour and not an asset: the app reads it to decide whether
   * the welcome screen wears the calligraphic حلال mark. Absent means off,
   * so a venue that never set the flag never claims the certification.
   */
  halal?: boolean;
  /** Baked into `extra.brand.apiUrl` for reference; builds still set EXPO_PUBLIC_API_URL. */
  apiUrl?: string | null;
  /** Reverse-DNS prefix for the store identifiers. */
  bundlePrefix?: string;
  /** App version string written into the Expo config. */
  version?: string;
  /** False when the logo has no alpha channel, so no monochrome icon is emitted. */
  monochrome?: boolean;
  /**
   * Average colour of the hero artwork this build ships, used to solve the
   * scrim's opacity. Absent means "assume the worst" (white artwork).
   */
  heroGroundHex?: string | null;
}

export interface MobileBrandAssets {
  icon: string;
  /** Full-bleed hero behind the welcome, home and account headers. */
  hero: string;
  adaptiveForeground: string;
  adaptiveBackground: string;
  adaptiveMonochrome: string | null;
  splash: string;
  favicon: string;
  logo: string;
}

export interface MobileBrand {
  venue: {
    /** The venue's full display name, exactly as the row holds it. */
    name: string;
    slug: string;
    themeId: string;
    logoKey: string | null;
    bannerKey: string | null;
    backdropId: string | null;
    /** Whether the app may show the halal mark — see `MobileBrandInput.halal`. */
    halal: boolean;
  };
  app: {
    /** The launcher label — `launcherName(venue.name)`, NOT the full name. */
    name: string;
    slug: string;
    scheme: string;
    version: string;
    iosBundleIdentifier: string;
    androidPackage: string;
  };
  colors: MobileColors;
  /** `rgba()` wash laid over the hero artwork so light ink on it clears AA. */
  scrim: string;
  assets: MobileBrandAssets;
  apiUrl: string | null;
}

export const DEFAULT_BUNDLE_PREFIX = "com.elvoria";
export const DEFAULT_APP_VERSION = "1.0.0";
/** Where `scripts/brand-mobile.ts` writes the rasterised assets. */
export const GENERATED_ASSET_DIR = "assets/generated";

// ---------------------------------------------------------------- colour math

/** Mix two #rrggbb colors; `t` is how far to travel from `a` toward `b`. */
function mixHex(a: string, b: string, t: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const chan = (x: number, y: number) => Math.round(x + (y - x) * k);
  return rgbToHex(chan(from.r, to.r), chan(from.g, to.g), chan(from.b, to.b));
}

function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Lighten (`t > 0`) or darken (`t < 0`) a color, keeping it a plain hex. */
function shade(hex: string, t: number): string {
  return mixHex(hex, t >= 0 ? "#ffffff" : "#000000", Math.abs(t));
}

/** True when white text beats black text on `hex` — our "is it dark" test. */
function isDark(hex: string): boolean {
  return onColorFor(hex) === "#ffffff";
}

function meets(fg: string, bg: string, level: ContrastLevel = "AA-normal"): boolean {
  return contrastRatio(fg, bg) >= (level === "AA-normal" ? AA_NORMAL : AA_LARGE);
}

/**
 * Walk `color` until it clears `level` against EVERY ground in `grounds`.
 * Each step delegates to `nearestPassingColor`, which moves lightness away
 * from the ground that failed; since our grounds sit on the same side of the
 * lightness axis (all light, or all dark), the walk converges instead of
 * oscillating. The iteration cap is a safety net, not the expected path.
 */
function ensureOn(color: string, grounds: string[], level: ContrastLevel = "AA-normal"): string {
  let out = color;
  for (let i = 0; i < 12; i++) {
    const failing = grounds.find((ground) => !meets(out, ground, level));
    if (!failing) return out;
    out = nearestPassingColor(out, failing, { level }) ?? onColorFor(failing);
  }
  return out;
}

/**
 * Push `color` away from every ground until it clears a raw ratio the two
 * WCAG levels can't express. Used for the chrome ground, which needs headroom
 * beyond AA — see `CHROME_ON_PAGE` below.
 */
function ensureRatioOn(color: string, grounds: string[], ratio: number): string {
  let out = color;
  for (let i = 0; i < 40; i++) {
    const failing = grounds.find((ground) => contrastRatio(out, ground) < ratio);
    if (!failing) return out;
    const next = mixHex(out, isDark(failing) ? "#ffffff" : "#000000", 0.06);
    if (next === out) return out;
    out = next;
  }
  return out;
}

/**
 * The accent has to work in two opposite roles at once: readable AS text on
 * the brand ground, and readable AS a ground under `ink`. Both pushes move it
 * the same direction (away from two dark colors ⇒ lighter), so alternating
 * between them terminates.
 */
function solveAccentOnBrand(accent: string, brand: string, ink: string): string {
  let out = accent;
  for (let i = 0; i < 12; i++) {
    if (!meets(out, brand)) {
      out = nearestPassingColor(out, brand) ?? shade(out, 0.12);
      continue;
    }
    if (!meets(ink, out)) {
      out = nearestPassingColor(out, ink) ?? shade(out, 0.12);
      continue;
    }
    return out;
  }
  return out;
}

/** Ink for a solid fill: the theme's own ink when it clears AA, else B/W. */
function inkOn(ground: string, preferred: string[]): string {
  const winner = preferred.find((candidate) => meets(candidate, ground));
  return winner ?? onColorFor(ground);
}

// ------------------------------------------------------------------- palette

export function deriveMobileColors(theme: MenuTheme): MobileColors {
  const darkTheme = isDark(theme.vars.bg);

  // Page + card grounds. A light theme lends its own; a dark theme lends its
  // light ink, lifted into parchment — the app stays a light-ground app with
  // brand-colored chrome (the shape every screen is laid out for) instead of
  // painting the whole app in the menu's page color.
  const cream = darkTheme ? shade(theme.vars.text, 0.1) : theme.vars.bg;
  const cardSeed = darkTheme
    ? contrastRatio(cream, "#ffffff") < 1.08
      ? shade(cream, -0.04)
      : shade(cream, 0.45)
    : theme.vars.surface;
  // The card ground must sit on the SAME side of the lightness axis as the
  // page: every token below is solved against both grounds at once, and a
  // split-polarity pair (pizza-mizza puts near-black cards on a white page)
  // has no colour that reads on both. Such a theme gets a card derived from
  // its own page instead. The same nudge covers themes that reuse one colour
  // for page and card, so cards still read as raised.
  const cardSplit = isDark(cardSeed) !== isDark(cream);
  const cardFlat = contrastRatio(cardSeed, cream) < 1.03;
  const creamCard = cardSplit || cardFlat ? shade(cream, isDark(cream) ? 0.08 : -0.045) : cardSeed;
  const grounds = [cream, creamCard];

  // Body ink. A light theme's text/textSoft already clear AA on its own bg
  // (menu-themes-contrast.test.ts); re-checking costs nothing and covers the
  // card ground too. A dark theme has no dark ink to lend, so we brew one
  // from the brand hue.
  const brandSeed = darkTheme ? theme.vars.bg : theme.vars.accent;
  const ink = ensureOn(darkTheme ? shade(brandSeed, -0.62) : theme.vars.text, grounds);
  const inkSoft = ensureOn(darkTheme ? shade(ink, 0.34) : theme.vars.textSoft, grounds);

  // Chrome ground. Doubles as a text color on the page, so it must clear AA
  // on both grounds before it is allowed to be the header fill — and then
  // some: AA alone leaves a light theme's accent barely dark enough that the
  // only accent able to sit ON it at AA is a near-white tint, which turns the
  // house look (gold on red) into washed-out peach. `CHROME_ON_PAGE` of
  // headroom keeps the chrome deep enough for a real mid-tone accent.
  const red = ensureRatioOn(ensureOn(brandSeed, grounds), grounds, CHROME_ON_PAGE);
  const redDark = shade(red, -0.22);
  const onRed = inkOn(red, [theme.vars.text, theme.vars.surfaceText ?? theme.vars.text]);

  const goldSoft = solveAccentOnBrand(theme.vars.accent, red, ink);
  const gold = ensureOn(theme.vars.accent, grounds);

  return {
    red,
    redDark,
    cream,
    creamCard,
    gold,
    goldSoft,
    ink,
    inkSoft,
    line: mixHex(cream, ink, 0.14),
    onRed,
    positive: ensureOn(theme.vars.positive, grounds),
    danger: ensureOn(dangerFor(creamCard), grounds),
  };
}

/**
 * Opacity of the wash between the hero artwork and the text on it.
 *
 * The app used to hard-code `rgba(110, 14, 14, 0.45)`, which only worked
 * because the bundled artwork happened to be dark. Once the artwork comes from
 * the venue, "dark enough" stops being an assumption we may make: a light
 * backdrop left the welcome screen's cream ink at ~1.4:1. So the wash is
 * solved instead — the lightest brand-hued veil under which both the hero ink
 * (`onRed`) and its accent line (`goldSoft`) still clear AA over the artwork
 * this build actually ships.
 */
export function deriveScrim(colors: MobileColors, groundHex: string): string {
  const { r, g, b } = hexToRgb(colors.redDark);
  for (let alpha = 0.3; alpha < 0.95; alpha += 0.02) {
    const composite = mixHex(groundHex, colors.redDark, alpha);
    if (meets(colors.onRed, composite) && meets(colors.goldSoft, composite)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }
  }
  return `rgba(${r}, ${g}, ${b}, 0.94)`;
}

// ------------------------------------------------------------- identifiers

/**
 * Separator the venue name uses between the house name and its qualifier
 * (city, branch): space, U+00B7 MIDDLE DOT, space.
 */
const NAME_QUALIFIER = " · ";

/**
 * Generic venue-type nouns. Dropping one loses nothing a guest needs to
 * recognise the icon — "Rangla Punjab" identifies the restaurant; the word
 * "Restaurant" is what every restaurant is called. Matched case-insensitively
 * against the LAST word only, so "Kitchen Garden" or "Grill 54" keep theirs.
 */
const VENUE_TYPE_WORDS = new Set([
  "restaurant",
  "ristorante",
  "restaurante",
  "imbiss",
  "bistro",
  "café",
  "cafe",
  "pizzeria",
  "grill",
  "kitchen",
  "küche",
]);

/**
 * The launcher label: what a phone prints under the app icon.
 *
 * This is NOT the venue's name. Home screens give a label roughly 11–13
 * characters before they truncate — iOS middle-truncates ("Rangla…onstanz")
 * and Android tail-truncates to one or two lines — so a full row value like
 * "Rangla Punjab Restaurant · Konstanz" reaches the guest as ellipsis soup on
 * every device. `expo.name` is exactly that label (prebuild writes it to
 * `CFBundleDisplayName` and Android's `app_name`), so it gets the short form
 * while `venue.name` / `brand.name` keep the full string for the screens,
 * which have room to lay it out over two lines.
 *
 * The shortening is two conservative cuts, both of which only ever remove
 * words the guest does not need to tell one restaurant from another:
 *
 *   1. Everything from the first ` · ` on — the qualifier is a city or branch.
 *   2. A trailing generic venue-type noun, if a name remains without it.
 *
 * Whatever is left is returned as-is: no truncation, no ellipsis. A name that
 * is still long after both cuts is the venue's own choice, and mangling it
 * further would be worse than letting the OS do its own truncation.
 *
 *   "Rangla Punjab Restaurant · Konstanz" → "Rangla Punjab"
 *   "Rangla Punjab · Konstanz"            → "Rangla Punjab"
 *   "Bella Italia"                        → "Bella Italia"
 *   "Restaurant"                          → "Restaurant"  (nothing else left)
 */
export function launcherName(venueName: string): string {
  const head = venueName.split(NAME_QUALIFIER)[0]!.trim();
  const words = head.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 1 && last && VENUE_TYPE_WORDS.has(last.toLowerCase())) {
    return words.slice(0, -1).join(" ");
  }
  return words.join(" ");
}

/** Expo slug: lowercase, `a-z0-9-`, no leading/trailing or doubled dashes. */
export function expoSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "venue";
}

/**
 * Deep-link scheme: letters/digits only (dashes are legal in a URI scheme but
 * trip up several native intent filters), and it must start with a letter.
 */
export function expoScheme(raw: string): string {
  const compact = expoSlug(raw).replace(/-/g, "").slice(0, 30);
  if (!compact) return "elvoria";
  return /^[a-z]/.test(compact) ? compact : `app${compact}`.slice(0, 30);
}

/** Store identifier segment: `a-z0-9` plus dots, never starting with a digit. */
function bundleSegment(raw: string): string {
  const compact = expoSlug(raw).replace(/-/g, "");
  if (!compact) return "venue";
  return /^[a-z]/.test(compact) ? compact : `v${compact}`;
}

// --------------------------------------------------------------- assembly

export function deriveMobileBrand(input: MobileBrandInput): MobileBrand {
  const theme = resolveMenuTheme(input.themeId);
  const slug = expoSlug(input.slug);
  const prefix = input.bundlePrefix?.trim() || DEFAULT_BUNDLE_PREFIX;
  const asset = (file: string) => `./${GENERATED_ASSET_DIR}/${file}`;
  const name = input.name.trim() || slug;
  const colors = deriveMobileColors(theme);

  return {
    venue: {
      name,
      slug: input.slug,
      themeId: theme.id,
      logoKey: input.logoKey ?? null,
      bannerKey: input.bannerKey ?? null,
      backdropId: input.backdropId ?? null,
      // Strictly `=== true`: anything else — undefined, a stray string, an
      // older caller — means the venue has not claimed it.
      halal: input.halal === true,
    },
    app: {
      // The launcher label, not the venue name — see `launcherName`. The
      // `|| name` is for a name made only of a qualifier separator.
      name: launcherName(name) || name,
      slug,
      scheme: expoScheme(input.slug),
      version: input.version?.trim() || DEFAULT_APP_VERSION,
      iosBundleIdentifier: `${prefix}.${bundleSegment(input.slug)}`,
      androidPackage: `${prefix}.${bundleSegment(input.slug)}`.replace(/-/g, "_"),
    },
    colors,
    scrim: deriveScrim(colors, input.heroGroundHex?.trim() || "#ffffff"),
    assets: {
      icon: asset("icon.png"),
      hero: asset("hero.jpg"),
      adaptiveForeground: asset("adaptive-foreground.png"),
      adaptiveBackground: asset("adaptive-background.png"),
      adaptiveMonochrome: input.monochrome === false ? null : asset("adaptive-monochrome.png"),
      splash: asset("splash.png"),
      favicon: asset("favicon.png"),
      logo: asset("logo.png"),
    },
    apiUrl: input.apiUrl?.trim() || null,
  };
}

/**
 * The brand-derived half of the Expo config. `mobile/app.config.js` merges
 * this over the static `app.json`, so only fields that follow from the venue
 * live here — orientation, plugins and the like stay in app.json where a
 * human edits them.
 */
export function buildExpoBrandConfig(brand: MobileBrand): Record<string, unknown> {
  const adaptiveIcon: Record<string, string> = {
    backgroundColor: brand.colors.red,
    foregroundImage: brand.assets.adaptiveForeground,
    backgroundImage: brand.assets.adaptiveBackground,
  };
  if (brand.assets.adaptiveMonochrome) {
    adaptiveIcon.monochromeImage = brand.assets.adaptiveMonochrome;
  }
  return {
    name: brand.app.name,
    slug: brand.app.slug,
    scheme: brand.app.scheme,
    version: brand.app.version,
    icon: brand.assets.icon,
    backgroundColor: brand.colors.red,
    splash: {
      image: brand.assets.splash,
      resizeMode: "contain",
      backgroundColor: brand.colors.red,
    },
    ios: { bundleIdentifier: brand.app.iosBundleIdentifier },
    android: { package: brand.app.androidPackage, adaptiveIcon },
    web: { favicon: brand.assets.favicon },
    extra: {
      // Omitted rather than null when unset — Expo's config serializer turns a
      // null leaf into `{}`, which reads as a mystery empty object in
      // `npx expo config`.
      brand: {
        venueSlug: brand.venue.slug,
        // The short launcher form, matching `name` above: this block is the
        // config's own identity echo, and the screens read the full name from
        // `brand.generated.ts` / the menu payload, never from here.
        venueName: brand.app.name,
        themeId: brand.venue.themeId,
        ...(brand.apiUrl ? { apiUrl: brand.apiUrl } : {}),
      },
    },
  };
}

/** Full contents of `mobile/brand.generated.json`. */
export function buildBrandManifest(brand: MobileBrand): Record<string, unknown> {
  return {
    $generated: "pnpm brand:mobile — generated file, do not edit by hand",
    venue: brand.venue,
    colors: brand.colors,
    scrim: brand.scrim,
    assets: brand.assets,
    expo: buildExpoBrandConfig(brand),
  };
}

/** Source of `mobile/src/brand.generated.ts`, the app's palette + identity. */
export function renderBrandModule(brand: MobileBrand): string {
  const tokens = Object.entries(brand.colors)
    .map(([key, value]) => `  ${key}: "${value}",`)
    .join("\n");
  return `/**
 * GENERATED by \`pnpm brand:mobile\` — do not edit by hand.
 *
 * Venue: ${brand.venue.name} (${brand.venue.slug}) · menu theme: ${brand.venue.themeId}
 * Every pairing the screens rely on (ink on cream, gold on red, ink on the
 * gold CTA fill …) clears WCAG AA by construction — see
 * src/lib/mobile-brand.ts in the web app.
 */

export const brand = {
  name: ${JSON.stringify(brand.venue.name)},
  slug: ${JSON.stringify(brand.venue.slug)},
  themeId: ${JSON.stringify(brand.venue.themeId)},
  /** The venue advertises a halal kitchen (\`branding.halalFilter === "on"\`).
   *  Gates the calligraphic حلال mark on the welcome screen. */
  halal: ${JSON.stringify(brand.venue.halal)},
} as const;

export const colors = {
${tokens}
} as const;

/** Wash between the hero artwork and the text over it — see deriveScrim. */
export const scrim = ${JSON.stringify(brand.scrim)};

/** The venue logo, rasterised next to the app icons by the same script. */
export const logo = require("../${GENERATED_ASSET_DIR}/logo.png");

/** Hero artwork: the venue's banner, its menu backdrop, or a palette gradient. */
export const hero = require("../${GENERATED_ASSET_DIR}/hero.jpg");
`;
}
