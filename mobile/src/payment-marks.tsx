import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { colors } from "./theme";

/* ── Payment brand marks ─────────────────────────────────────────────────
 *
 * Drawn here as inline SVG rather than shipped as images: four small
 * vectors cost nothing in the bundle, stay sharp at any density, and
 * never 404. They are simplified, generic representations — enough for a
 * guest to recognise the row at a glance, not facsimiles of the
 * trademarks. They are decorative: every row carries its own text label,
 * and the marks are hidden from the accessibility tree.
 */

const MARK_W = 34;
const MARK_H = 22;

export function VisaMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#1a1f71" />
      <SvgText
        x={17}
        y={15}
        fill="#ffffff"
        fontSize={9}
        fontWeight="bold"
        letterSpacing={0.5}
        textAnchor="middle"
      >
        VISA
      </SvgText>
    </Svg>
  );
}

export function MastercardMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#ffffff" stroke={colors.line} />
      <Circle cx={14} cy={11} r={6.5} fill="#eb001b" />
      <Circle cx={20} cy={11} r={6.5} fill="#f79e1b" opacity={0.85} />
    </Svg>
  );
}

export function PaypalMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#ffffff" stroke={colors.line} />
      <Path d="M15 4 h6 a4 4 0 1 1 0 8 h-3 l-1 6 h-3 z" fill="#009cde" />
      <Path d="M10 4 h6 a4 4 0 1 1 0 8 h-3 l-1 6 h-3 z" fill="#003087" />
    </Svg>
  );
}

export function CashMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#ffffff" stroke={colors.line} />
      <Rect x={4} y={5} width={26} height={12} rx={2} fill="#e9f3e4" stroke="#3f7030" />
      <Circle cx={17} cy={11} r={3.2} fill="none" stroke="#3f7030" strokeWidth={1.2} />
    </Svg>
  );
}

export type PaymentMarkMethod = "card" | "paypal" | "cash";

/**
 * The marks at the end of a payment-method row — one component so the
 * checkout and the gift-card screen draw the SAME row (owner,
 * 2026-09-25: "keep resemblance for payment icons"). Decorative and
 * hidden from the accessibility tree: the row's label says what it is.
 */
export function PaymentMarks({ method }: { method: PaymentMarkMethod }): React.ReactElement {
  return (
    <View
      style={styles.marks}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {method === "card" ? (
        <>
          <VisaMark />
          <MastercardMark />
        </>
      ) : method === "paypal" ? (
        <PaypalMark />
      ) : (
        <CashMark />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  marks: { flexDirection: "row", alignItems: "center", gap: 5 },
});
