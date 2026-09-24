import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { useI18n } from "./i18n";

/**
 * The owner's "sticker" lettering — the lime, black-outlined, white-rimmed
 * face of the RESTAURANT word on the logo — for the headings that wear
 * it: the venue's own name on the launch screen and in the app header,
 * OPENING HOURS on Account, POINTS in the header badge.
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

/** The lime the fill fades between, and the flat one the Arabic fallback
 *  wears (a gradient needs glyph outlines this fallback doesn't draw). */
const LIME_TOP = "#F0FF4D";
const LIME = "#A8E000";

/** Stroke widths, the pad they need around the box, and the spare room
 *  Android's wider SVG metrics ask for — all as functions of the drawn
 *  size, so `maxWidth` can re-derive them at the shrunk size. */
const rimFor = (size: number): number => Math.max(3, size * 0.3);
const padFor = (size: number): number => Math.ceil(rimFor(size) / 2) + 1;
// Android draws Luckiest Guy a little wider in SVG than the <Text> ruler
// measures it, which clipped the last letter ("POINT" for "POINTS").
// The text is drawn CENTRED with this much spare room, so any mismatch is
// shared out to both sides instead of falling off the end.
const slackFor = (size: number): number => Math.ceil(size * 0.35);
// A little air between letters so the black outlines don't fuse.
const trackingFor = (size: number): number => size * 0.05;
/** The width the invisible ruler measures in — far past any real screen,
 *  so nothing it reports is a container's width rather than the text's. */
const RULER_ROOM = 4000;

export function CartoonTitle({
  text,
  size = 22,
  maxWidth,
  style,
}: {
  text: string;
  /** Font size in pt; the strokes scale with it. */
  size?: number;
  /**
   * The widest the finished box may be, in pt. Past it the whole
   * lettering — glyphs, strokes and tracking together — is scaled DOWN
   * until it fits, which is how a long venue name goes into a fixed slot
   * (the header's middle) without being clipped or ellipsised.
   *
   * It is a pure scale, not a re-measure: a line's width is linear in its
   * font size, so the ruler's measurement at `size` already says what any
   * smaller size would measure. That keeps this to ONE layout pass — a
   * measure-shrink-measure loop would visibly flicker on every mount.
   */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { lang } = useI18n();
  /** The ruler's answer, at `size`. 0 until it has reported. */
  const [measured, setMeasured] = useState(0);
  /**
   * Which ruler answered.
   *
   * `onTextLayout` is the exact one — the sum of the line boxes' own
   * advances — but react-native-web does not implement it at all, so on
   * web it never fires and the lettering used to stay invisible (the
   * POINTS badge and OPENING HOURS with it). `onLayout` is the fallback:
   * the ruler is absolutely positioned with no width, so it shrink-wraps
   * its text on both platforms and its layout box is the line's width to
   * within a rounding.
   *
   * Native fires BOTH, so once the exact one has spoken the box
   * measurement is ignored rather than allowed to fight it.
   */
  const exact = useRef(false);
  const report = useCallback((w: number, isExact: boolean): void => {
    if (w <= 0) return;
    if (exact.current && !isExact) return;
    if (isExact) exact.current = true;
    setMeasured((current) => (Math.abs(w - current) > 0.5 ? Math.ceil(w) : current));
  }, []);

  const natural = measured > 0 ? measured + padFor(size) * 2 + slackFor(size) : 0;
  const scale = maxWidth && natural > maxWidth ? maxWidth / natural : 1;
  const drawn = size * scale;
  const width = measured * scale;
  const rim = rimFor(drawn);
  const outline = Math.max(2, drawn * 0.16);
  const pad = padFor(drawn);
  const slack = slackFor(drawn);
  const box = width + pad * 2 + slack;
  // Luckiest Guy sits high in its line box: cap height ≈ 0.75 em.
  const height = Math.ceil(drawn * 1.05 + pad * 2);
  const baseline = pad + drawn * 0.86;
  const tracking = trackingFor(drawn);

  if (lang === "ar") {
    return (
      <Text
        style={[styles.fallback, { fontSize: size }]}
        accessibilityRole="header"
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {text}
      </Text>
    );
  }

  return (
    <View
      style={[{ height, width: width > 0 ? box : undefined }, style]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={text}
    >
      {/* The ruler: same font, at the UNSCALED size, invisible, never read
          out. Scaling its answer is what `maxWidth` is built on, so this
          one must not move when the drawn size does.

          It measures inside a box a thousand points wider than any phone
          because a text box is measured against the room it is GIVEN: in
          the layout the ruler would otherwise sit in, its parent is this
          component, whose width comes from the ruler's own answer — so
          the two settle on the container's width and the lettering then
          spills out of a box too small for it (measured: the venue's name
          clipped at both ends). An absolute box with a stated width is
          outside that loop, and `alignSelf: flex-start` is what makes the
          Text inside it shrink-wrap the line rather than fill it. */}
      <View style={styles.rulerBox} pointerEvents="none">
        <Text
          // The SVG lettering never follows the phone's Text Size setting,
          // so its ruler must not either: a guest on a smaller text size
          // otherwise gets a box sized for narrower letters and the mark
          // clipped at both ends (owner's phone, 2026-09-24).
          allowFontScaling={false}
          style={[
            styles.ruler,
            { fontFamily: CARTOON_FONT, fontSize: size, letterSpacing: trackingFor(size) },
          ]}
          onTextLayout={(e) =>
            report(
              e.nativeEvent.lines.reduce((sum, l) => sum + l.width, 0),
              true,
            )
          }
          onLayout={(e) => report(e.nativeEvent.layout.width, false)}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {text}
        </Text>
      </View>
      {width > 0 ? (
        <Svg width={box} height={height}>
          <Defs>
            <LinearGradient id="lime" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={LIME_TOP} />
              <Stop offset="1" stopColor={LIME} />
            </LinearGradient>
          </Defs>
          {[
            { stroke: "#FFFFFF", strokeWidth: rim, fill: "#FFFFFF" },
            { stroke: "#141414", strokeWidth: outline, fill: "#141414" },
            { stroke: "none", strokeWidth: 0, fill: "url(#lime)" },
          ].map((layer, i) => (
            <SvgText
              key={i}
              x={box / 2}
              textAnchor="middle"
              y={baseline}
              fontFamily={CARTOON_FONT}
              fontSize={drawn}
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
  /** The measuring room: wider than any screen, out of the flow, and
   *  invisible. See the note at the ruler itself. */
  rulerBox: { position: "absolute", left: 0, top: 0, width: RULER_ROOM, opacity: 0 },
  /** `flex-start` so the Text shrink-wraps its line inside that room
   *  instead of filling it; `maxWidth` overrides the base `max-width:
   *  100%` every react-native-web Text carries, which would otherwise cap
   *  the answer at the room's own width. */
  ruler: { alignSelf: "flex-start", maxWidth: RULER_ROOM, flexShrink: 0 },
  fallback: {
    color: LIME,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 2,
  },
});
