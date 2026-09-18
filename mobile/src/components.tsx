import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, logo, money, radius } from "./theme";
import { useI18n } from "./i18n";
import type { ApiItem } from "./api";

/** Red screen header with the brand mark — the mockup's top bar. */
export function BrandHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <View style={styles.header}>
      <Image source={logo} style={styles.headerLogo} />
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={{ width: 40 }} />
    </View>
  );
}

export function SectionTitle({
  children,
  action,
  onAction,
}: {
  children: string;
  action?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  tone = "gold",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "gold" | "red";
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.primaryBtn,
        tone === "red" ? { backgroundColor: colors.red } : null,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone === "red" ? colors.onRed : colors.ink} />
      ) : (
        <Text style={[styles.primaryBtnText, tone === "red" && { color: colors.onRed }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** The mockup's dish row: photo left, name + description, price, red ⊕. */
export function DishRow({
  item,
  onAdd,
  onOpen,
}: {
  item: ApiItem;
  onAdd: (item: ApiItem) => void;
  /** Tapping the card opens the details sheet — the row is deliberately
   *  clipped to keep every card the same height. */
  onOpen?: (item: ApiItem) => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <Pressable style={styles.dishRow} onPress={() => onOpen?.(item)} accessibilityLabel={item.name}>
      <Image source={{ uri: item.photoUrl }} style={styles.dishPhoto} resizeMode="cover" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.dishName} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.dishDescBox}>
          {item.description ? (
            <Text style={styles.dishDesc} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          {item.offer ? (
            <>
              <View style={styles.offerBadge}>
                <Text style={styles.offerBadgeText}>{t.offer}</Text>
              </View>
              <Text style={styles.dishBasePrice}>
                {money(item.offer.basePriceCents, item.currency)}
              </Text>
            </>
          ) : null}
          <Text style={styles.dishPrice}>{money(item.priceCents, item.currency)}</Text>
          {item.isAvailable ? (
            <Pressable
              onPress={() => onAdd(item)}
              hitSlop={10}
              accessibilityLabel={`${item.name} hinzufügen`}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.addBtnText}>+</Text>
            </Pressable>
          ) : (
            <Text style={[styles.soldOut, { marginLeft: "auto" }]}>{t.soldOut}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export function QtyStepper({
  quantity,
  onChange,
}: {
  quantity: number;
  onChange: (next: number) => void;
}): React.ReactElement {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(quantity - 1)} hitSlop={8} style={styles.stepBtn}>
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepQty}>{quantity}</Text>
      <Pressable onPress={() => onChange(quantity + 1)} hitSlop={8} style={styles.stepBtn}>
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.red,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLogo: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cream },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { color: colors.onRed, fontSize: 20, fontFamily: fonts.display },
  headerSubtitle: {
    color: colors.goldSoft,
    fontFamily: fonts.body,
    fontSize: 11,
    letterSpacing: 3,
    marginTop: 1,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: { color: colors.ink, fontSize: 18, fontFamily: fonts.bodyBold },
  sectionAction: { color: colors.red, fontSize: 13, fontFamily: fonts.bodySemi },
  primaryBtn: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.ink, fontFamily: fonts.bodyBold, letterSpacing: 0.5 },
  // The photo is INSET, not bled to the card edges: a full-height image
  // fought the card's own rounding and grew with the description, so a
  // long dish looked like a poster. Fixed square thumb, padded all round.
  dishRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
    // Fixed height + clipped text = a uniform grid. A one-line dish and a
    // three-line one are the same card; the sheet carries the rest.
    height: 106,
    overflow: "hidden",
  },
  /** Reserved for two description lines, so a dish WITHOUT a description
   *  doesn't pull its price row up and break the alignment. */
  dishDescBox: { height: 36, justifyContent: "flex-start" },
  dishPhoto: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    backgroundColor: colors.line,
  },
  dishName: { color: colors.ink, fontSize: 15.5, lineHeight: 20, fontFamily: fonts.bodyBold },
  dishDesc: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 },
  dishPrice: { color: colors.red, fontSize: 14, fontFamily: fonts.bodyBold },
  dishBasePrice: {
    color: colors.inkSoft,
    fontFamily: fonts.body,
    fontSize: 12,
    textDecorationLine: "line-through",
  },
  offerBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  offerBadgeText: {
    color: colors.ink,
    fontSize: 8,
    fontFamily: fonts.bodyHeavy,
    letterSpacing: 0.5,
  },
  // Mockup's add control: a soft-cornered SQUARE pinned to the card's
  // bottom-right, sitting on the price row.
  // Smaller tile, bigger glyph: the button reads as a compact control
  // while the "+" stays the thing the thumb aims at. hitSlop on the
  // Pressable keeps the tap target comfortable despite the smaller box.
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  addBtnText: { color: colors.onRed, fontSize: 22, fontFamily: fonts.bodySemi, lineHeight: 25 },
  soldOut: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 11, fontStyle: "italic" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: colors.red, fontSize: 16, fontFamily: fonts.bodyBold, lineHeight: 18 },
  stepQty: {
    color: colors.ink,
    fontSize: 15,
    fontFamily: fonts.bodyBold,
    minWidth: 18,
    textAlign: "center",
  },
});
