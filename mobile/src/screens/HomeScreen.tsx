import React from "react";
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ApiMenu, ApiItem } from "../api";
import { BrandHeader, DishRow, SectionTitle } from "../components";
import { colors, radius } from "../theme";
import { useI18n } from "../i18n";

/**
 * Start — the mockup's home: red brand header, artwork hero, the
 * Lieferung/Abholung entry points, category medallions, popular dishes.
 */
export function HomeScreen({
  menu,
  onAdd,
  onOpenCategory,
  onBrowseAll,
  onStartOrder,
}: {
  menu: ApiMenu;
  onAdd: (item: ApiItem) => void;
  onOpenCategory: (categoryId: string) => void;
  onBrowseAll: () => void;
  onStartOrder: (type: "takeaway" | "delivery") => void;
}): React.ReactElement {
  const { t } = useI18n();
  const popular = menu.categories
    .flatMap((c) => c.items)
    .filter((i) => i.isAvailable)
    .slice(0, 6);
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={menu.venue.name} subtitle={t.restaurant} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <ImageBackground
          source={require("../../assets/artwork.jpg")}
          style={styles.hero}
          imageStyle={{ borderRadius: radius.lg }}
        >
          <View style={styles.heroInner}>
            <Text style={styles.heroText}>{t.heroLine}</Text>
          </View>
        </ImageBackground>

        <View style={styles.modeRow}>
          {menu.ordering.delivery ? (
            <Pressable style={styles.modeCard} onPress={() => onStartOrder("delivery")}>
              <Text style={styles.modeEmoji}>🛵</Text>
              <Text style={styles.modeTitle}>{t.delivery}</Text>
              <Text style={styles.modeSub}>{t.deliverySub}</Text>
            </Pressable>
          ) : null}
          {menu.ordering.takeaway ? (
            <Pressable style={styles.modeCard} onPress={() => onStartOrder("takeaway")}>
              <Text style={styles.modeEmoji}>🛍️</Text>
              <Text style={styles.modeTitle}>{t.pickup}</Text>
              <Text style={styles.modeSub}>{t.pickupSub}</Text>
            </Pressable>
          ) : null}
        </View>

        <SectionTitle action={t.showAll} onAction={onBrowseAll}>
          {t.categories}
        </SectionTitle>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 14 }}
        >
          {menu.categories.map((cat) => (
            <Pressable key={cat.id} style={styles.catChip} onPress={() => onOpenCategory(cat.id)}>
              {cat.photoUrl ? (
                <Image source={{ uri: cat.photoUrl }} style={styles.catPhoto} />
              ) : (
                <View style={[styles.catPhoto, styles.catFallback]}>
                  <Text style={{ fontSize: 22 }}>🍛</Text>
                </View>
              )}
              <Text style={styles.catName} numberOfLines={1}>
                {cat.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <SectionTitle action={t.showAll} onAction={onBrowseAll}>
          {t.popular}
        </SectionTitle>
        <View style={{ gap: 10 }}>
          {popular.map((item) => (
            <DishRow key={item.id} item={item} onAdd={onAdd} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 150, borderRadius: radius.lg, overflow: "hidden" },
  heroInner: { flex: 1, justifyContent: "center", padding: 18 },
  heroText: {
    color: colors.onRed,
    fontSize: 20,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowRadius: 6,
    maxWidth: 220,
  },
  modeRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  modeCard: {
    flex: 1,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    alignItems: "center",
    gap: 2,
  },
  modeEmoji: { fontSize: 26 },
  modeTitle: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  modeSub: { color: colors.inkSoft, fontSize: 11 },
  catChip: { alignItems: "center", width: 72 },
  catPhoto: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.line },
  catFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.creamCard,
  },
  catName: { color: colors.ink, fontSize: 11, marginTop: 5, fontWeight: "600" },
});
