import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, fonts } from "./theme";

/**
 * The halal mark: حلال set in naskh calligraphy, with "Halal" beneath it.
 *
 * It is ART, not an emoji and not a translation. The 🕌 mosque glyph the
 * diet chips used to carry says "Islam", which is not the same claim as
 * "this kitchen is halal", and it renders as a different picture on every
 * platform. The word itself, in the script it belongs to, says the thing
 * exactly once and looks the same everywhere because the face
 * (`fonts.arabicDisplay` = Amiri) ships inside the binary.
 *
 * GREEN, by the owner's word and from their own signage: `colors.halal`,
 * the bright shop-window green, on BOTH the calligraphy and the Latin
 * caption. It measures 4.79:1 on the brand red the welcome screen puts it
 * on — past AA even though the mark is decorative. `color` stays a prop
 * because the cream surfaces cannot take that green (1.8:1); the dish
 * DETAILS chip passes the palette's darker `positive` instead, which is
 * still green and clears AA on the card.
 *
 * TWO sizes, because those are the two jobs:
 *
 *  - `"badge"` — the welcome screen's corner mark: the calligraphy with
 *    the Latin "Halal" under it (so a guest who cannot read Arabic still
 *    gets the word). Set STRAIGHT, and the two words at the SAME visual
 *    size (owner, 2026-09-21) — it used to be a small caption under a
 *    large word, tilted like a stamp.
 *  - `"chip"` — inline in a dish's diet chip. No caption, because the chip
 *    already prints "Halal" next to it in the guest's own language, and
 *    no rotation either.
 *
 * `writingDirection: "rtl"` is stated rather than left to the layout: the
 * app runs LTR on five of its six locales, and an Arabic string in an LTR
 * paragraph is at the mercy of the bidi algorithm for its trailing marks.
 *
 * One accessibility node for the whole thing ("Halal"), because two — the
 * Arabic and the caption — would have a screen reader say it twice, once
 * in a language the reader may not have a voice for.
 */
export function HalalMark({
  size = "badge",
  color = colors.halal,
  shadow,
  style,
}: {
  size?: "badge" | "chip";
  /** Defaults to the halal green of the owner's own signage. Override it
   *  only where that green cannot be read — see the note above. */
  color?: string;
  /**
   * The soft drop shadow that keeps white art readable on photographic
   * artwork. On by default for the badge (its only home is the welcome
   * hero) and off for the chip, which is usually inline on a cream card —
   * the dish photo's badge stack passes it explicitly.
   */
  shadow?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const badge = size === "badge";
  const shaded = shadow ?? badge;
  return (
    <View
      style={[badge ? styles.badge : styles.chip, style]}
      accessibilityRole="image"
      accessibilityLabel="Halal"
    >
      <Text
        // The RN-typed spelling of HTML's `lang`: it tells the platform's
        // reader this run is Arabic, so a device that has an Arabic voice
        // does not read the glyphs with a German one. (`lang` itself is
        // not on RN's `Text` props, only on react-native-web's.)
        accessibilityLanguage="ar"
        style={[badge ? styles.wordBadge : styles.wordChip, shaded && styles.shadow, { color }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        allowFontScaling={false}
      >
        حلال
      </Text>
      {badge ? (
        <Text
          style={[styles.caption, shaded && styles.shadow, { color }]}
          allowFontScaling={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          Halal
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Straight, word over word. */
  badge: { alignItems: "center", gap: 0 },
  /** No caption and no gap: the chip's own label follows it on the line. */
  chip: { alignItems: "center", justifyContent: "center" },
  /**
   * Amiri's naskh has deep descenders (the ل and the final ل both drop
   * well below the baseline), so `lineHeight` is stated at ~1.4× rather
   * than left to the platform — Android otherwise clips the tail on the
   * welcome screen and iOS pads it.
   */
  wordBadge: {
    ...fonts.arabicDisplay,
    fontSize: 26,
    lineHeight: 36,
    writingDirection: "rtl",
  },
  wordChip: {
    ...fonts.arabicDisplay,
    fontSize: 14,
    lineHeight: 20,
    writingDirection: "rtl",
  },
  /** The Latin word under the calligraphy, sized to MATCH it: Amiri's
   *  naskh at 26 pt and Nunito bold at 18 pt read as the same size (the
   *  Arabic's letters sit small in a tall line box). */
  caption: { ...fonts.bodyBold, fontSize: 18, lineHeight: 22, letterSpacing: 0.5 },
  /** What keeps white art off a bright photograph — the same soft shadow
   *  the welcome screen's own headings and the dish badges wear. */
  shadow: {
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
});
