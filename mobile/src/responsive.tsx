import React from "react";
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

import { useLayout } from "./layout";

/**
 * The guest half of the app on a tablet.
 *
 * On a phone every one of these is a pass-through: a single column,
 * full-width controls, exactly the mockup. From `TWO_COL_MIN` up (an
 * iPad, or a phone on its side) they spread out, because a full-width
 * pill across 1032 pt of glass reads as a banner, not a button.
 */

/**
 * Children laid out `columns` per row — 1 on a phone, 2 on a tablet in
 * portrait, 3 in landscape.
 *
 * Rows of `flex: 1` cells rather than percentage widths: `%` and `gap`
 * fight (see `Layout.cardWidth`), and a row needs no measurement, so the
 * first frame is already the right shape. A short last row is padded
 * with empty cells so its cards keep the same width as the ones above.
 */
export function Grid({
  children,
  gap = 10,
  maxColumns = 3,
}: {
  children: React.ReactNode;
  gap?: number;
  maxColumns?: number;
}): React.ReactElement {
  const { wide, width } = useLayout();
  const { height } = useWindowDimensions();
  // Two in portrait, three once the glass is on its side — decided by the
  // shape, not the size, so a 13" iPad upright still gets two roomy cards.
  const columns = !wide ? 1 : Math.min(width > height ? 3 : 2, maxColumns);
  const cells = React.Children.toArray(children);
  if (columns <= 1) return <View style={{ gap }}>{cells}</View>;
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap }}>
          {row.map((cell, c) => (
            <View key={c} style={{ flex: 1, minWidth: 0 }}>
              {cell}
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, c) => (
            <View key={`pad-${c}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Two or three peer controls: stacked on a phone, one line of equal
 * widths on a tablet — "Anmelden | Registrieren", payment choices.
 */
export function Row({
  children,
  gap = 10,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { wide } = useLayout();
  const cells = React.Children.toArray(children).filter(Boolean);
  if (!wide) return <View style={[{ gap }, style]}>{cells}</View>;
  return (
    <View style={[{ flexDirection: "row", gap }, style]}>
      {cells.map((cell, i) => (
        <View key={i} style={{ flex: 1, minWidth: 0 }}>
          {cell}
        </View>
      ))}
    </View>
  );
}

/** The widest a lone primary action (Bestellen, Bezahlen) gets on a tablet. */
export const ACTION_MAX = 380;

/**
 * A single call to action: full width on a phone, a centred pill of at
 * most `ACTION_MAX` on a tablet — it stands out by being alone, not by
 * spanning the screen.
 */
export function Action({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { wide } = useLayout();
  if (!wide) return <>{children}</>;
  return (
    <View style={[{ width: "100%", maxWidth: ACTION_MAX, alignSelf: "center" }, style]}>
      {children}
    </View>
  );
}

/** The centred reading column (`CONTENT_MAX`) on a tablet; nothing on a phone. */
export function useColumn(): ViewStyle | null {
  const { wide, content } = useLayout();
  return wide ? content : null;
}
