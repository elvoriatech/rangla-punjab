import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, money, radius } from "./theme";
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
      <Image source={require("../assets/rangla-logo.png")} style={styles.headerLogo} />
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
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
}: {
  item: ApiItem;
  onAdd: (item: ApiItem) => void;
}): React.ReactElement {
  return (
    <View style={styles.dishRow}>
      <Image source={{ uri: item.photoUrl }} style={styles.dishPhoto} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.dishName} numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text style={styles.dishDesc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          {item.offer ? (
            <>
              <View style={styles.offerBadge}>
                <Text style={styles.offerBadgeText}>ANGEBOT</Text>
              </View>
              <Text style={styles.dishBasePrice}>
                {money(item.offer.basePriceCents, item.currency)}
              </Text>
            </>
          ) : null}
          <Text style={styles.dishPrice}>{money(item.priceCents, item.currency)}</Text>
        </View>
      </View>
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
        <Text style={styles.soldOut}>ausverkauft</Text>
      )}
    </View>
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
  headerTitle: { color: colors.onRed, fontSize: 20, fontWeight: "700" },
  headerSubtitle: { color: colors.goldSoft, fontSize: 12, marginTop: 1 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "700" },
  sectionAction: { color: colors.red, fontSize: 13, fontWeight: "600" },
  primaryBtn: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.ink, fontWeight: "700", letterSpacing: 0.5 },
  dishRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
  },
  dishPhoto: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.line },
  dishName: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  dishDesc: { color: colors.inkSoft, fontSize: 12 },
  dishPrice: { color: colors.red, fontSize: 14, fontWeight: "700" },
  dishBasePrice: {
    color: colors.inkSoft,
    fontSize: 12,
    textDecorationLine: "line-through",
  },
  offerBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  offerBadgeText: { color: colors.ink, fontSize: 8, fontWeight: "800", letterSpacing: 0.5 },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: colors.onRed, fontSize: 20, fontWeight: "700", lineHeight: 22 },
  soldOut: { color: colors.inkSoft, fontSize: 11, fontStyle: "italic" },
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
  stepBtnText: { color: colors.red, fontSize: 16, fontWeight: "700", lineHeight: 18 },
  stepQty: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    minWidth: 18,
    textAlign: "center",
  },
});
