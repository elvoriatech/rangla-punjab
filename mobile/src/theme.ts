/**
 * Rangla Punjab brand — values lifted from the approved mobile mockup:
 * deep Punjabi red, warm cream, antique gold, espresso ink on cream.
 * One source of truth for every screen; no other hex belongs in the app.
 */
export const colors = {
  red: "#9d1c1c",
  redDark: "#7d1414",
  cream: "#faf3e3",
  creamCard: "#fffaf0",
  gold: "#c9a227",
  goldSoft: "#e8c15c",
  ink: "#35200f",
  inkSoft: "#6f5b45",
  line: "#e6d9bd",
  onRed: "#fdf3dd",
  positive: "#1f6b3a",
  danger: "#b3261e",
} as const;

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
