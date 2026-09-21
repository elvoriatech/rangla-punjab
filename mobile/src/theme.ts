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
 *
 * `ember` is the far end of the Offers pulse (see `usePulse`). It is not
 * brand either: the pulse only reads as movement if the two tones are far
 * enough apart, and every warm colour the venue already owns — red, gold,
 * goldSoft — is within a few degrees of hue of the others. It is used for
 * a border and a glow only, never behind text, so no contrast pair depends
 * on it; a venue whose generated gold drifts orange still gets a visible
 * swing because this end is fixed.
 *
 * `halal` is the bright green of the owner's own signage, and it is NOT
 * brand either — that is the whole point. Halal green is a convention a
 * guest recognises from a shop window, so it has to survive a venue
 * whose palette is blue, and it must not drift when `pnpm brand:mobile`
 * re-derives the theme. It measures 4.79:1 on the brand red the welcome
 * screen puts it on, so the mark clears AA there even though it is
 * decorative; on the CREAM surfaces it would be 1.8:1, which is why the
 * dish-details chip uses the palette's own darker `positive` instead
 * (see `halal-mark.tsx`).
 */
export const colors = {
  ...generated,
  info: "#1f4e79",
  infoSoft: "#eef3fa",
  ember: "#f28c28",
  halal: "#33d94a",
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
 * ONE face for the whole app: Nunito, loaded in App.tsx. Custom families
 * don't synthesize weights reliably on Android, so every weight is its own
 * family name.
 *
 * The `display*` tokens used to be Playfair Display, a serif, and are now
 * Nunito 800 — at the owner's word, so that every screen HEADING is set in
 * the same face as the venue's own name. The token NAMES are deliberately
 * unchanged: `display` still means "this is a heading", which is the thing
 * call sites actually care about, and keeping the names meant repointing
 * the type system in one place instead of touching forty screens. It also
 * leaves the door open to a second display face later without another
 * sweep. `displayHeavy` is now the same family as `display` — the serif had
 * two weights worth distinguishing and Nunito 800 is already the top of
 * this ramp; the token stays so the call sites that mean "heaviest
 * heading" keep saying so.
 *
 * Each token is a STYLE FRAGMENT, not a family string — spread it
 * (`{ ...fonts.bodyBold }`) instead of writing `fontFamily:`. That is what
 * lets the RTL build swap the whole set: Nunito is Latin-only and would
 * render Arabic as tofu, so an RTL layout falls back to the platform's own
 * UI font and expresses weight with `fontWeight`.
 *
 * `arabicDisplay` is the one token that does NOT swap. It is Amiri, a
 * naskh face bundled with the app, and it exists for exactly one string:
 * the calligraphic حلال on the halal mark. That glyph is Arabic on every
 * build — a German guest sees the same mark a Saudi one does — so falling
 * back to the platform UI font here would flatten the calligraphy that is
 * the whole point of it. Amiri covers Arabic script, so it is safe to name
 * in the RTL map too.
 */
const latin = {
  display: { fontFamily: "Nunito_800ExtraBold" },
  displayHeavy: { fontFamily: "Nunito_800ExtraBold" },
  displayItalic: { fontFamily: "Nunito_800ExtraBold_Italic" },
  body: { fontFamily: "Nunito_400Regular" },
  bodyLight: { fontFamily: "Nunito_300Light" },
  bodySemi: { fontFamily: "Nunito_600SemiBold" },
  bodyBold: { fontFamily: "Nunito_700Bold" },
  bodyHeavy: { fontFamily: "Nunito_800ExtraBold" },
  arabicDisplay: { fontFamily: "Amiri_700Bold" },
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
  // Bundled and script-correct, so the RTL build keeps the same face.
  arabicDisplay: { fontFamily: "Amiri_700Bold" },
} as const satisfies Record<keyof typeof latin, TextStyle>;

export const fonts: Record<keyof typeof latin, TextStyle> = isRTL ? system : latin;

export function money(cents: number, currency = "EUR"): string {
  const eur = (cents / 100).toFixed(2).replace(".", ",");
  return currency === "EUR" ? `€${eur}` : `${eur} ${currency}`;
}
