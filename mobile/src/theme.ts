import { I18nManager, type TextStyle } from "react-native";

/**
 * The app's brand tokens. The palette itself is DERIVED from the venue's menu
 * theme and written to `brand.generated.ts` by `pnpm brand:mobile` — the same
 * deep red, warm cream, antique gold and espresso ink as the approved mockup
 * when the venue runs the "rangla-royal" theme, and a coherent, AA-checked
 * equivalent for any other venue the app is built for.
 *
 * One source of truth for every screen; no other hex belongs in the app, and
 * nothing brand-shaped should be hand-edited here.
 */
import { colors as generated } from "./brand.generated";

export { brand, logo, hero, scrim } from "./brand.generated";

/**
 * The generated palette, plus the few SEMANTIC colours that are not the
 * venue's brand and must therefore survive a re-generation.
 *
 * `info` / `infoSoft` mean "scheduled for later" on the restaurant board:
 * a pre-order that isn't due yet. Every other colour on that screen is
 * already spoken for — red is live, gold is "just arrived", green is
 * settled, `danger` is a cancellation — so a cool blue is the only tint
 * the counter cannot misread. Both pairings clear WCAG AA on the card:
 * ink-blue on the tint is 7.8:1, and the app's muted ink still reads
 * 5.3:1 against it.
 */
export const colors = {
  ...generated,
  info: "#1f4e79",
  infoSoft: "#eef3fa",
} as const;

/**
 * "Are we open?" — the one piece of venue state that belongs in the app
 * header, in the two tones it can have.
 *
 * SEMANTIC, not brand: a venue whose generated palette happens to be
 * green must still get a red "closed", so these do not come from
 * `brand.generated`. Each tone is a full trio (dot, fill, text) because
 * the pill sits on the RED header, where the venue's own `positive`
 * would not clear AA on its own.
 *
 * Contrast, measured against each tone's own fill: open 7.4:1, closed
 * 8.1:1 — both comfortably past WCAG AA for the 11 pt label. And the
 * colour is never the only signal: the pill always carries the WORD, so
 * it reads the same to someone who cannot tell the two dots apart.
 */
export const statusTones = {
  open: { dot: "#2f7a43", fill: "#e6f4ea", text: "#1f5c31" },
  closed: { dot: "#a4231b", fill: "#fdeae8", text: "#8a1c15" },
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/**
 * Layout direction. This is a NATIVE, process-wide flag (`I18nManager`),
 * not React state: it can only change across a restart, so reading it once
 * at module load is correct and lets StyleSheet objects bake it in. The
 * language switcher flips it and reloads the app (see `i18n.tsx`).
 */
export const isRTL = I18nManager.isRTL;

/** Chevrons that point "forward"/"back" in reading order. Use these instead
 *  of a literal › or ‹ so they mirror with the layout. */
export const CHEVRON_FORWARD = isRTL ? "‹" : "›";
export const CHEVRON_BACK = isRTL ? "›" : "‹";

/**
 * Display serif (Playfair Display) + soft body sans (Nunito), loaded in
 * App.tsx. Custom families don't synthesize weights reliably on Android, so
 * every weight is its own family name.
 *
 * Each token is a STYLE FRAGMENT, not a family string — spread it
 * (`{ ...fonts.bodyBold }`) instead of writing `fontFamily:`. That is what
 * lets the RTL build swap the whole set: Nunito and Playfair are Latin-only
 * and would render Arabic as tofu, so an RTL layout falls back to the
 * platform's own UI font and expresses weight with `fontWeight`.
 */
const latin = {
  display: { fontFamily: "PlayfairDisplay_700Bold" },
  displayHeavy: { fontFamily: "PlayfairDisplay_800ExtraBold" },
  displayItalic: { fontFamily: "PlayfairDisplay_600SemiBold_Italic" },
  body: { fontFamily: "Nunito_400Regular" },
  bodyLight: { fontFamily: "Nunito_300Light" },
  bodySemi: { fontFamily: "Nunito_600SemiBold" },
  bodyBold: { fontFamily: "Nunito_700Bold" },
  bodyHeavy: { fontFamily: "Nunito_800ExtraBold" },
} as const satisfies Record<string, TextStyle>;

const system = {
  display: { fontWeight: "700" },
  displayHeavy: { fontWeight: "800" },
  displayItalic: { fontWeight: "600", fontStyle: "italic" },
  body: { fontWeight: "400" },
  bodyLight: { fontWeight: "300" },
  bodySemi: { fontWeight: "600" },
  bodyBold: { fontWeight: "700" },
  bodyHeavy: { fontWeight: "800" },
} as const satisfies Record<keyof typeof latin, TextStyle>;

export const fonts: Record<keyof typeof latin, TextStyle> = isRTL ? system : latin;

export function money(cents: number, currency = "EUR"): string {
  const eur = (cents / 100).toFixed(2).replace(".", ",");
  return currency === "EUR" ? `€${eur}` : `${eur} ${currency}`;
}
