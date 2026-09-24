import React, { useCallback, useId, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, {
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
  TextPath,
} from "react-native-svg";
import { CARTOON_FONT } from "./cartoon-title";
import { useI18n } from "./i18n";

/**
 * The venue's NAME, set as the lockup on its own posters.
 *
 * The owner's artwork (the home-slider banners, the printed menus, the
 * e-mail header) always sets the restaurant's name the same way: the
 * first words big on one line, the kind of place — "RESTAURANT" —
 * smaller and tucked under it, both in the lime sticker lettering with a
 * black outline and a white rim. Wherever this app prints the venue's
 * name as a heading it prints THAT, so the screen and the poster next to
 * it are the same mark (owner, 2026-09-22: "same font, width, height and
 * curve as the images I gave you").
 *
 * Every constant below was measured off those posters rather than
 * chosen. The method: the lockup's block (outline included) is 4.62
 * times as wide as it is tall on the service poster and 4.82 on the
 * welcome one; a candidate built from these numbers measures 4.66, which
 * is inside the difference between the owner's own two posters.
 *
 * The one thing a font cannot give us is the artwork's WIDTH: the poster
 * lettering is a condensed cut, about four fifths of Luckiest Guy's
 * natural advance. `SQUEEZE` is that, applied as a viewBox stretch so
 * the strokes narrow with the glyphs exactly as they do in the artwork —
 * scaling a coordinate system, not faking a font.
 */

/**
 * Line 2's font size, as a share of line 1's.
 *
 * Measured off the owner's own lockup: "RESTAURANT" stands about two
 * thirds of "RANGLA PUNJAB"'s cap height there and runs to about 62 % of
 * its width (owner, 2026-09-22: "size also same"). Luckiest Guy set at
 * that height only reaches 54 % of the width on its own, so `TRACK2`
 * makes up the rest — the artwork's second line is spaced out, not just
 * scaled up.
 *
 * It rose from 0.66 when the top line came down 5 pt (owner, same day:
 * "only make the Rangla Punjab 5 pixels smaller … only the name"). This
 * ratio is the ONLY thing that sets the two lines against each other, so
 * shrinking one of them means raising it — the second line keeps the
 * size it had.
 */
const LINE2 = 0.725;
/** Letter spacing on each line, as a share of that line's own size. */
const TRACK1 = 0.02;
const TRACK2 = 0.08;
/**
 * Air between the two lines, as a share of F — counted from where line
 * 1's arch bottoms out, so it is clearance and not a guess. Small,
 * because the arch's own rise is most of the separation in the owner's
 * lockup (owner, 2026-09-22: "restaurant is straight and down").
 */
const GAP = 0.04;
/** Stroke widths as a share of line 1's font size. SVG centres a stroke
 *  on the path, so each contributes half its width outside the glyph. */
const RIM = 0.23;
const OUTLINE = 0.13;
/** The artwork's horizontal compression (see the note above). */
const SQUEEZE = 0.8;
/**
 * The ARCH — how far the middle of a line rises above its ends, as a
 * share of that line's width.
 *
 * The posters' lettering is not set on a straight baseline; it curves up
 * through the middle like a shop sign, and the glyphs lean with it
 * (owner, 2026-09-22: "make same direction of fonts"). Fitting a
 * parabola to the top edge of the service poster's first line gives a
 * rise of 31 px across a 600 px line — the 5.2 % below. Each line arches
 * by the same SHARE of its own width, so the short second line curves
 * less in absolute terms, exactly as it does in the artwork.
 */
const ARCH = 0.052;
/**
 * …and line 2 does not arch at all.
 *
 * Only the top line curves in the owner's artwork; "RESTAURANT" is set
 * straight underneath it (owner, 2026-09-22: "see restaurant is straight
 * and down"). It reads as the base the arch sits on — curve them both
 * and the mark loses its footing.
 */
const ARCH_LINE2 = 0;
/** Luckiest Guy's cap height, and the drop below its baseline. */
const CAP = 0.72;
const DESCENT = 0.06;
/** The measuring room — wider than any screen, so a ruler never reports
 *  a container's width instead of the text's (react-native-web clamps a
 *  Text to its parent, and the parent here is sized FROM the ruler). */
const RULER_ROOM = 4000;

/** The lime the poster letters are filled with, top to bottom. */
const FILL = ["#E8FA4B", "#A9E01C", "#4FA916"] as const;

export interface WordmarkLines {
  top: string;
  bottom: string | null;
}

/**
 * Split a venue name the way the artwork does: the last word — the kind
 * of place — drops to the small second line.
 *
 * Only from three words up. "Rangla Punjab" is a name, not a name and a
 * category, and hanging "PUNJAB" under "RANGLA" would invent a lockup
 * the venue does not have.
 */
export function wordmarkLines(name: string): WordmarkLines {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return { top: words.join(" ").toUpperCase(), bottom: null };
  return {
    top: words.slice(0, -1).join(" ").toUpperCase(),
    bottom: words[words.length - 1]!.toUpperCase(),
  };
}

/**
 * The baseline one line is set on: a circular arc whose ends sit at
 * `yEnds` and whose middle rises `rise` above them, drawn left to right.
 *
 * The radius comes from the sagitta of a chord — r = c²/8s + s/2 — so
 * the curve is stated by the thing that was measured (how far the middle
 * rises) rather than by a radius someone picked. A rise of nothing is a
 * straight line, which is what a one-word name gets.
 */
/**
 * The arc's own centre is nudged half a letter-space right of the mark's
 * centre by the caller, and this is why: `letterSpacing` puts a gap after
 * the LAST glyph as well as between them, so the advance the renderer
 * centres on the path is half a gap wider than the ink. On a straight
 * baseline that is half a point of drift and invisible; on an arc it
 * tilts the whole word — the first letter slides down the curve and the
 * last one rides up it (owner, 2026-09-22: "R and last B should be on
 * the same line"). Moving the apex instead of the text keeps
 * `startOffset="50%"`, which is the form react-native-svg actually
 * centres on: a numeric offset lays the text out from there instead, and
 * the line runs off the end of its own path.
 */
function arc(cx: number, yEnds: number, width: number, rise: number): string {
  const half = width / 2;
  if (!(rise > 0.5) || !(width > 0)) return `M ${cx - half} ${yEnds} L ${cx + half} ${yEnds}`;
  const r = (width * width) / (8 * rise) + rise / 2;
  // sweep-flag 1: y grows downward, so "clockwise" is the way that bulges
  // the arc UP through the middle.
  return `M ${cx - half} ${yEnds} A ${r} ${r} 0 0 1 ${cx + half} ${yEnds}`;
}

export function VenueWordmark({
  name,
  size = 30,
  maxWidth,
  style,
}: {
  /** The venue's name. Split into the lockup's two lines here. */
  name: string;
  /** Line 1's font size in pt. Everything else is derived from it. */
  size?: number;
  /** The widest the finished mark may be. Past it the whole lockup —
   *  glyphs, strokes, tracking and the squeeze together — scales down,
   *  so a long name shrinks instead of being clipped. */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { lang } = useI18n();
  const { top, bottom } = wordmarkLines(name);
  /** Each line's measured advance, at its own size. 0 until it reports. */
  const [w1, setW1] = useState(0);
  const [w2, setW2] = useState(0);
  /**
   * Whether the EXACT ruler has answered for each line.
   *
   * `onTextLayout` gives the line box's own advance but react-native-web
   * does not implement it, so on web only `onLayout` ever fires and the
   * mark would otherwise never be drawn. Native fires both; once the
   * exact one has spoken the box measurement is ignored.
   */
  const exact = useRef({ top: false, bottom: false });
  const report = useCallback((line: "top" | "bottom", w: number, isExact: boolean): void => {
    if (w <= 0) return;
    if (exact.current[line] && !isExact) return;
    if (isExact) exact.current[line] = true;
    const set = line === "top" ? setW1 : setW2;
    set((current) => (Math.abs(w - current) > 0.5 ? Math.ceil(w) : current));
  }, []);

  const size2 = size * LINE2;
  const ready = w1 > 0 && (bottom === null || w2 > 0);
  /** SVG ids are document-wide on the web build, and two marks can be on
   *  screen at once (the header's and a screen's). */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  /**
   * How much the whole mark has to come down to sit inside `maxWidth`.
   *
   * Worked out from the UNSCALED measurements, then applied to every
   * number below, so the SVG is drawn at its final size. It is deliberate
   * that no `viewBox` does this scaling: react-native-svg does not scale
   * `TextPath` content to a viewBox on iOS — it draws the text at its
   * stated size and clips it to the viewport, which cost this mark its
   * first and last letters (measured, 2026-09-22).
   */
  const natural = Math.max(w1, w2) + RIM * size + 2;
  const fit = maxWidth && natural * SQUEEZE > maxWidth ? maxWidth / (natural * SQUEEZE) : 1;

  // The lockup, in the points it will actually be drawn at. Each line's
  // MIDDLE sits at its apex baseline and its ends hang `rise` lower,
  // which is the arch.
  const f1 = size * fit;
  const f2 = size2 * fit;
  const a1 = w1 * fit;
  const a2 = w2 * fit;
  const pad = (RIM * f1) / 2 + 1;
  const rise1 = a1 * ARCH;
  const rise2 = a2 * ARCH_LINE2;
  const apex1 = pad + CAP * f1;
  // Line 2 clears line 1's ENDS, not its middle: the top line arches, so
  // its first and last letters hang `rise1` below its own baseline and a
  // second line measured from the apex runs straight into them.
  const apex2 = apex1 + rise1 + CAP * f2 + GAP * f1;
  const naturalW = Math.max(a1, a2) + RIM * f1 + 2;
  const naturalH =
    (bottom === null ? apex1 + rise1 + DESCENT * f1 : apex2 + rise2 + DESCENT * f2) + pad;

  // The squeeze is the one transform left, and it is a `G` rather than a
  // viewBox for the same reason.
  const boxW = naturalW * SQUEEZE;
  const boxH = naturalH;

  if (lang === "ar") {
    // Luckiest Guy has no Arabic letters. Plain heavy text in the same
    // lime is legible; tofu is not.
    return (
      <Text
        style={[styles.fallback, { fontSize: size * 0.8 }]}
        accessibilityRole="header"
        numberOfLines={2}
        adjustsFontSizeToFit
      >
        {name}
      </Text>
    );
  }

  const line = (text: string, fontSize: number, id: string, track: number): React.ReactElement => (
    <>
      {[
        { stroke: "#FFFFFF", width: RIM * f1, fill: "#FFFFFF" },
        { stroke: "#141414", width: OUTLINE * f1, fill: "#141414" },
        { stroke: "none", width: 0, fill: `url(#lime${uid})` },
      ].map((layer, i) => (
        <SvgText
          key={`${id}-${i}`}
          textAnchor="middle"
          fontFamily={CARTOON_FONT}
          fontSize={fontSize}
          letterSpacing={fontSize * track}
          fill={layer.fill}
          stroke={layer.stroke}
          strokeWidth={layer.width}
          strokeLinejoin="round"
        >
          {/* The arc carries the glyphs AND their angle: each letter sits
              on the tangent, which is what makes the line read as one
              curved sign rather than as text that has been shifted up. */}
          <TextPath href={`#${id}`} startOffset="50%">
            {text}
          </TextPath>
        </SvgText>
      ))}
    </>
  );

  return (
    <View
      style={[{ width: ready ? boxW : undefined, height: boxH }, style]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={name}
    >
      {/* The rulers: the same font at the same sizes, invisible, never
          read out, and measured in a box far wider than the mark so the
          answer is the text's width and not the container's. */}
      <View style={styles.rulerBox} pointerEvents="none">
        <Text
          // The SVG lettering never follows the phone's Text Size setting,
          // so its rulers must not either: on a smaller text size the box
          // was sized for narrower letters and the mark lost its first and
          // last letters (owner's phone, 2026-09-24).
          allowFontScaling={false}
          style={[styles.ruler, { fontSize: size, letterSpacing: size * TRACK1 }]}
          onTextLayout={(e) =>
            report(
              "top",
              e.nativeEvent.lines.reduce((sum, l) => sum + l.width, 0),
              true,
            )
          }
          onLayout={(e) => report("top", e.nativeEvent.layout.width, false)}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {top}
        </Text>
        {bottom ? (
          <Text
            allowFontScaling={false}
            style={[styles.ruler, { fontSize: size2, letterSpacing: size2 * TRACK2 }]}
            onTextLayout={(e) =>
              report(
                "bottom",
                e.nativeEvent.lines.reduce((sum, l) => sum + l.width, 0),
                true,
              )
            }
            onLayout={(e) => report("bottom", e.nativeEvent.layout.width, false)}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {bottom}
          </Text>
        ) : null}
      </View>
      {ready ? (
        // `preserveAspectRatio="none"` is what applies the squeeze: the
        // mark is drawn in its natural coordinates and the viewport is
        // narrower, so glyphs AND strokes condense together.
        <Svg width={boxW} height={boxH}>
          <Defs>
            <LinearGradient id={`lime${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={FILL[0]} />
              <Stop offset="0.55" stopColor={FILL[1]} />
              <Stop offset="1" stopColor={FILL[2]} />
            </LinearGradient>
            <Path
              id={`arcA${uid}`}
              d={arc(naturalW / 2 + (f1 * TRACK1) / 2, apex1 + rise1, a1, rise1)}
            />
            {bottom ? (
              <Path
                id={`arcB${uid}`}
                d={arc(naturalW / 2 + (f2 * TRACK2) / 2, apex2 + rise2, a2, rise2)}
              />
            ) : null}
          </Defs>
          {/* The artwork's condensed width. A group transform, because it
              has to compress the strokes with the glyphs. */}
          <G transform={`scale(${SQUEEZE} 1)`}>
            {line(top, f1, `arcA${uid}`, TRACK1)}
            {bottom ? line(bottom, f2, `arcB${uid}`, TRACK2) : null}
          </G>
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rulerBox: { position: "absolute", left: 0, top: 0, width: RULER_ROOM, opacity: 0 },
  /** `flex-start` so each ruler shrink-wraps its line inside that room
   *  instead of filling it; `maxWidth` overrides the base `max-width:
   *  100%` every react-native-web Text carries, which would otherwise cap
   *  the answer at the room's own width. */
  ruler: {
    fontFamily: CARTOON_FONT,
    alignSelf: "flex-start",
    maxWidth: RULER_ROOM,
    flexShrink: 0,
  },
  fallback: {
    color: FILL[1],
    fontWeight: "800",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 2,
  },
});
