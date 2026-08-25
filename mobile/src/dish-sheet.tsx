import React from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiItem } from "./api";
import { useI18n } from "./i18n";
import { colors, fonts, money, radius } from "./theme";

/**
 * Dish details. The list rows are deliberately uniform — one line of name,
 * two of description — so a long dish can't make its card taller than its
 * neighbours; everything that gets clipped there lives here: the full
 * description, allergens, traces, diet tags and spice level.
 *
 * Labels are duplicated from src/lib/allergens.ts on purpose: the RN
 * bundle can't import the Next app's modules, and the guest surface must
 * not ship a placeholder like "gluten_free".
 */

const ALLERGENS: Record<string, { de: string; en: string }> = {
  gluten: { de: "Gluten", en: "gluten" },
  crustaceans: { de: "Krebstiere", en: "crustaceans" },
  eggs: { de: "Eier", en: "eggs" },
  fish: { de: "Fisch", en: "fish" },
  peanuts: { de: "Erdnüsse", en: "peanuts" },
  soybeans: { de: "Sojabohnen", en: "soybeans" },
  milk: { de: "Milch", en: "milk" },
  nuts: { de: "Schalenfrüchte", en: "nuts" },
  celery: { de: "Sellerie", en: "celery" },
  mustard: { de: "Senf", en: "mustard" },
  sesame: { de: "Sesam", en: "sesame" },
  sulphites: { de: "Sulfite", en: "sulphites" },
  lupin: { de: "Lupinen", en: "lupin" },
  molluscs: { de: "Weichtiere", en: "molluscs" },
};

const DIETARY: Record<string, { de: string; en: string; icon: string }> = {
  vegetarian: { de: "Vegetarisch", en: "Vegetarian", icon: "🌿" },
  vegan: { de: "Vegan", en: "Vegan", icon: "🌱" },
  gluten_free: { de: "Glutenfrei", en: "Gluten-free", icon: "🌾" },
  dairy_free: { de: "Laktosefrei", en: "Dairy-free", icon: "🥛" },
  halal: { de: "Halal", en: "Halal", icon: "🕌" },
};

export function DishSheet({
  item,
  onClose,
  onAdd,
}: {
  item: ApiItem | null;
  onClose: () => void;
  onAdd: (item: ApiItem) => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const label = (map: Record<string, { de: string; en: string }>, key: string): string =>
    map[key] ? (lang === "de" ? map[key]!.de : map[key]!.en) : key.replaceAll("_", " ");

  return (
    <Modal visible={item !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {item ? (
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              <Image source={{ uri: item.photoUrl }} style={styles.hero} resizeMode="cover" />
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

                {item.dietary.length > 0 ? (
                  <View style={styles.tagRow}>
                    {item.dietary.map((d) => (
                      <View key={d} style={styles.tag}>
                        <Text style={styles.tagText}>
                          {DIETARY[d]?.icon ?? "•"} {label(DIETARY, d)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {item.allergens.length > 0 ? (
                  <View style={{ gap: 3 }}>
                    <Text style={styles.metaLabel}>{t.dishAllergens}</Text>
                    <Text style={styles.metaValue}>
                      {item.allergens.map((a) => label(ALLERGENS, a)).join(", ")}
                    </Text>
                  </View>
                ) : null}

                {item.traces.length > 0 ? (
                  <View style={{ gap: 3 }}>
                    <Text style={styles.metaLabel}>{t.dishTraces}</Text>
                    <Text style={styles.metaValue}>
                      {item.traces.map((a) => label(ALLERGENS, a)).join(", ")}
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
        </View>
      </View>
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
  close: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(20,10,5,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: colors.onRed, fontSize: 22, lineHeight: 24 },
  name: { color: colors.ink, fontFamily: fonts.display, fontSize: 23, lineHeight: 29 },
  price: { color: colors.red, fontFamily: fonts.bodyHeavy, fontSize: 19 },
  basePrice: {
    color: colors.inkSoft,
    fontFamily: fonts.body,
    fontSize: 15,
    textDecorationLine: "line-through",
  },
  spice: { fontSize: 14 },
  description: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 12 },
  metaLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  metaValue: { color: colors.ink, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 },
  cta: {
    backgroundColor: colors.red,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  ctaText: { color: colors.onRed, fontFamily: fonts.bodyHeavy, fontSize: 15 },
  soldOut: {
    color: colors.danger,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    textAlign: "center",
    marginTop: 6,
  },
});
