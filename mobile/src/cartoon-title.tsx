import React, { useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { useI18n } from "./i18n";

/**
 * The owner's "sticker" lettering — the lime, black-outlined, white-rimmed
 * face of the RESTAURANT word on the logo — for the few headings that
 * wear it: OPENING HOURS on Account, POINTS in the header badge.
 *
 * React Native cannot stroke text, so it is drawn as SVG in three passes
 * on the same baseline: a wide white stroke (the rim), a narrower black
 * one (the outline), then the lime fill on top. The SVG needs a width up
 * front, so an invisible copy of the text in the same font measures it
 * first; until then the box is empty rather than wrongly sized.
 *
 * Luckiest Guy has no Arabic letters, so in Arabic this falls back to
 * plain bold text in the same lime — legible, never tofu.
 */
export const CARTOON_FONT = "LuckiestGuy_400Regular";

export function CartoonTitle({
  text,
  size = 22,
  style,
}: {
  text: string;
  /** Font size in pt; the strokes scale with it. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { lang } = useI18n();
  const [width, setWidth] = useState(0);
  const rim = Math.max(3, size * 0.3);
  const outline = Math.max(2, size * 0.16);
  const pad = Math.ceil(rim / 2) + 1;
  // Luckiest Guy sits high in its line box: cap height ≈ 0.75 em.
  const height = Math.ceil(size * 1.05 + pad * 2);
  const baseline = pad + size * 0.86;
  // A little air between letters so the black outlines don't fuse.
  const tracking = size * 0.05;

  if (lang === "ar") {
    return (
      <Text style={[styles.fallback, { fontSize: size }]} accessibilityRole="header">
        {text}
      </Text>
    );
  }

  return (
    <View
      style={[{ height, width: width ? width + pad * 2 : undefined }, style]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={text}
    >
      {/* The ruler: same font and size, invisible, never read out. */}
      <Text
        style={[
          styles.ruler,
          { fontFamily: CARTOON_FONT, fontSize: size, letterSpacing: tracking },
        ]}
        onTextLayout={(e) => {
          const w = e.nativeEvent.lines.reduce((sum, l) => sum + l.width, 0);
          if (w > 0 && Math.abs(w - width) > 0.5) setWidth(Math.ceil(w));
        }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {text}
      </Text>
      {width > 0 ? (
        <Svg width={width + pad * 2} height={height}>
          <Defs>
            <LinearGradient id="lime" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#F0FF4D" />
              <Stop offset="1" stopColor="#A8E000" />
            </LinearGradient>
          </Defs>
          {[
            { stroke: "#FFFFFF", strokeWidth: rim, fill: "#FFFFFF" },
            { stroke: "#141414", strokeWidth: outline, fill: "#141414" },
            { stroke: "none", strokeWidth: 0, fill: "url(#lime)" },
          ].map((layer, i) => (
            <SvgText
              key={i}
              x={pad}
              y={baseline}
              fontFamily={CARTOON_FONT}
              fontSize={size}
              letterSpacing={tracking}
              fill={layer.fill}
              stroke={layer.stroke}
              strokeWidth={layer.strokeWidth}
              strokeLinejoin="round"
            >
              {text}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ruler: { position: "absolute", opacity: 0, left: 0, top: 0 },
  fallback: {
    color: "#A8E000",
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 2,
  },
});
