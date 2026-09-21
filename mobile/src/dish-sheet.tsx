import React from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiItem } from "./api";
import { DIET_ICONS, useI18n } from "./i18n";
import { colors, fonts, money, radius } from "./theme";
import { DishBadges } from "./components";
import { HalalMark } from "./halal-mark";

/**
 * Dish details. The list rows are deliberately uniform — one line of name,
 * two of description — so a long dish can't make its card taller than its
 * neighbours; everything that gets clipped there lives here: the full
 * description, allergens, traces, diet tags and spice level.
 *
 * The allergen and diet LABELS live in the per-language catalogue
 * (`i18n.tsx`) alongside every other string — one dictionary, five
 * languages, no second place to forget a translation.
 */

export function DishSheet({
  item,
  onClose,
  onAdd,
}: {
  item: ApiItem | null;
  onClose: () => void;
  onAdd: (item: ApiItem) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const label = (map: Record<string, string>, key: string): string =>
    map[key] ?? key.replaceAll("_", " ");

  return (
    <Modal visible={item !== null} animationType="slide" transparent onRequestClose={onClose}>
      {/* Tapping the dimmed area closes the sheet; the panel itself
          swallows touches so a tap inside never dismisses it. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {item ? (
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              <View>
                <Image source={{ uri: item.photoUrl }} style={styles.hero} resizeMode="cover" />
                {/* Under the close button: badges start below it. */}
                <View style={styles.heroBadges}>
                  <DishBadges item={item} max={6} size="lg" />
                </View>
              </View>
              <Pressable style={styles.close} onPress={onClose} hitSlop={10}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>

              <View style={{ padding: 18, gap: 10 }}>
                <Text style={styles.name}>{item.name}</Text>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {item.offer ? (
                    <Text style={styles.basePrice}>
                      {money(item.offer.basePriceCents, item.currency)}
                    </Text>
                  ) : null}
                  <Text style={styles.price}>{money(item.priceCents, item.currency)}</Text>
                  {item.spice > 0 ? (
                    <Text style={styles.spice}>{"🌶️".repeat(Math.min(item.spice, 3))}</Text>
                  ) : null}
                </View>

                {item.description ? (
                  <Text style={styles.description}>{item.description}</Text>
                ) : null}

                {/* Diet chips and the allergens share ONE line (owner,
                    2026-09-21): chips on the left, "Allergens: …" to their
                    right, wrapping inside the space that is left rather
                    than dropping to a block of its own. */}
                {item.dietary.length > 0 || item.allergens.length > 0 ? (
                  <View style={[styles.tagRow, styles.tagLine]}>
                    {item.dietary.map((d) =>
                      // Halal wears the venue's own حلال mark instead of an
                      // emoji — the same art the photo badges and the
                      // welcome screen carry (see `halal-mark.tsx`). Green,
                      // like everywhere else, but the palette's DARKER
                      // green: the mark's own shop-window green is 1.8:1
                      // on this cream plate, where `positive` is 4.69:1.
                      d === "halal" ? (
                        <View key={d} style={[styles.tag, styles.tagRowInner]}>
                          <HalalMark size="chip" color={colors.positive} />
                          <Text style={styles.tagText}>{label(t.dietary, d)}</Text>
                        </View>
                      ) : (
                        <View key={d} style={styles.tag}>
                          <Text style={styles.tagText}>
                            {DIET_ICONS[d] ?? "•"} {label(t.dietary, d)}
                          </Text>
                        </View>
                      ),
                    )}
                    {item.allergens.length > 0 ? (
                      <Text style={styles.allergenInline}>
                        <Text style={styles.metaLabel}>{t.dishAllergens}: </Text>
                        <Text style={styles.metaValue}>
                          {item.allergens.map((a) => label(t.allergens, a)).join(", ")}
                        </Text>
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {item.traces.length > 0 ? (
                  <View style={{ gap: 3 }}>
                    <Text style={styles.metaLabel}>{t.dishTraces}</Text>
                    <Text style={styles.metaValue}>
                      {item.traces.map((a) => label(t.allergens, a)).join(", ")}
                    </Text>
                  </View>
                ) : null}

                {item.isAvailable ? (
                  <Pressable
                    style={styles.cta}
                    onPress={() => {
                      onAdd(item);
                      onClose();
                    }}
                  >
                    <Text style={styles.ctaText}>
                      {t.dishAdd} · {money(item.priceCents, item.currency)}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.soldOut}>{t.soldOut}</Text>
                )}
              </View>
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  hero: { width: "100%", height: 210, backgroundColor: colors.line },
  heroBadges: { position: "absolute", top: 52, end: 10, bottom: 0, start: 0 },
  close: {
    position: "absolute",
    top: 12,
    end: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(20,10,5,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: colors.onRed, fontSize: 22, lineHeight: 24 },
  name: { color: colors.ink, ...fonts.display, fontSize: 23, lineHeight: 29 },
  price: { color: colors.red, ...fonts.bodyHeavy, fontSize: 19 },
  basePrice: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 15,
    textDecorationLine: "line-through",
  },
  spice: { fontSize: 14 },
  description: { color: colors.inkSoft, ...fonts.body, fontSize: 14.5, lineHeight: 21 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  /** Only the halal chip needs it: the mark is a View, so it and the
   *  label sit side by side rather than inside one Text run. */
  tagRowInner: { flexDirection: "row", alignItems: "center", gap: 6 },
  tagLine: { alignItems: "center", columnGap: 10 },
  /** Takes whatever width the chips leave and wraps inside it, so the
   *  allergens sit to the chips' right instead of on a line below. */
  allergenInline: { flexShrink: 1, flexGrow: 1, flexBasis: 140 },
  tagText: { color: colors.ink, ...fonts.bodySemi, fontSize: 12 },
  metaLabel: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  metaValue: { color: colors.ink, ...fonts.body, fontSize: 13.5, lineHeight: 19 },
  cta: {
    backgroundColor: colors.red,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  ctaText: { color: colors.onRed, ...fonts.bodyHeavy, fontSize: 15 },
  soldOut: {
    color: colors.danger,
    ...fonts.bodySemi,
    fontSize: 14,
    textAlign: "center",
    marginTop: 6,
  },
});
