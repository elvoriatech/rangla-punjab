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
export { colors, brand, logo, hero, scrim } from "./brand.generated";

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Display serif (Playfair Display) + soft body sans (Nunito), loaded in
 *  App.tsx. Custom families don't synthesize weights reliably on Android,
 *  so every weight is its own family name — use these instead of
 *  fontWeight anywhere text is styled. */
export const fonts = {
  display: "PlayfairDisplay_700Bold",
  displayHeavy: "PlayfairDisplay_800ExtraBold",
  displayItalic: "PlayfairDisplay_600SemiBold_Italic",
  body: "Nunito_400Regular",
  bodyLight: "Nunito_300Light",
  bodySemi: "Nunito_600SemiBold",
  bodyBold: "Nunito_700Bold",
  bodyHeavy: "Nunito_800ExtraBold",
} as const;

export function money(cents: number, currency = "EUR"): string {
  const eur = (cents / 100).toFixed(2).replace(".", ",");
  return currency === "EUR" ? `€${eur}` : `${eur} ${currency}`;
}
