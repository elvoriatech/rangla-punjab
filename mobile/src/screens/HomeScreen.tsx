import React, { useEffect, useRef, useState } from "react";
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
import { colors, fonts, radius } from "../theme";
import { useI18n } from "../i18n";

/**
 * Start — the mockup's home: red brand header, artwork hero carousel,
 * the Lieferung/Abholung entry points, category medallions, popular
 * dishes.
 */

// The design's hero: text on the red wave, a signature dish on the
// right — rotating through the house plates every few seconds.
const HERO_SLIDES = [
  require("../../assets/carousel/hero-biryani.png"),
  require("../../assets/carousel/hero-kebab.png"),
  require("../../assets/carousel/hero-karahi.png"),
  require("../../assets/carousel/hero-biryani-2.png"),
];

function HeroCarousel({ text }: { text: string }): React.ReactElement {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    if (!width) return;
    const id = setInterval(() => {
      setPage((current) => {
        const next = (current + 1) % HERO_SLIDES.length;
        scroller.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, 3500);
    return () => clearInterval(id);
  }, [width]);

  return (
    <ImageBackground
      source={require("../../assets/artwork.jpg")}
      style={styles.hero}
      imageStyle={{ borderRadius: radius.lg }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          if (width) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
      >
        {HERO_SLIDES.map((src, i) => (
          <View key={i} style={[styles.heroSlide, width ? { width } : null]}>
            <Text style={styles.heroText}>{text}</Text>
            <Image source={src} style={styles.heroDish} resizeMode="contain" />
          </View>
        ))}
      </ScrollView>
      <View style={styles.heroDots} pointerEvents="none">
        {HERO_SLIDES.map((_, i) => (
          <View key={i} style={[styles.heroDot, i === page && styles.heroDotActive]} />
        ))}
      </View>
    </ImageBackground>
  );
}
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
        <HeroCarousel text={t.heroLine} />

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
                  <Text style={{ fontFamily: fonts.body, fontSize: 22 }}>🍛</Text>
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
  hero: { height: 160, borderRadius: radius.lg, overflow: "hidden" },
  heroSlide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  // Cut-out plates float straight on the artwork — no frame, no white box.
  heroDish: { width: 136, height: 124 },
  heroDots: {
    position: "absolute",
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(253, 243, 221, 0.45)",
  },
  heroDotActive: { backgroundColor: colors.goldSoft },
  heroText: {
    color: colors.onRed,
    fontSize: 20,
    fontFamily: fonts.bodyHeavy,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowRadius: 6,
    flex: 1,
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
  modeEmoji: { fontFamily: fonts.body, fontSize: 26 },
  modeTitle: { color: colors.ink, fontFamily: fonts.bodyBold, fontSize: 14 },
  modeSub: { color: colors.inkSoft, fontFamily: fonts.body, fontSize: 11 },
  catChip: { alignItems: "center", width: 72 },
  catPhoto: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.line },
  catFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.creamCard,
  },
  catName: { color: colors.ink, fontSize: 11, marginTop: 5, fontFamily: fonts.bodySemi },
});
