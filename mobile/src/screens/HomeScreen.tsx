import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { ApiMenu, ApiItem, ApiRating } from "../api";
import { offerItems } from "../api";
import { useAuth } from "../auth";
import type { StaffOrdering } from "../staff";
import { fetchStaffOrdering, updateStaffOrdering } from "../staff";
import { BrandHeader, DishRow, SectionTitle } from "../components";
import { CHEVRON_FORWARD, colors, fonts, hero, money, radius, scrim } from "../theme";
import { fill, localeTag, useI18n } from "../i18n";
import { headlineVoucher, useLoyalty } from "../loyalty";
import { ReserveSheet, TableForGuestsIcon } from "../reserve-sheet";
import { DishSheet } from "../dish-sheet";

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
      source={hero}
      style={styles.hero}
      // Explicit cover: without it the generated artwork drives the hero's
      // intrinsic width, stretching the carousel slides past the screen.
      resizeMode="cover"
      imageStyle={{ borderRadius: radius.lg, width: "100%", height: "100%" }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {/* The artwork is the venue's own now, so its brightness is unknown at
          build time — the generated scrim is what keeps the headline legible
          over a pale backdrop as well as a dark one. */}
      <View style={styles.heroScrim} pointerEvents="none" />
      <ScrollView
        ref={scroller}
        style={styles.heroScroll}
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
/**
 * "★ 4.6 (312) · Write a review" — the venue's Google rating, right under
 * the hero (P7-14).
 *
 * One line, not a card: it is a credential, not an offer. Tapping opens
 * Google's own review form in the system browser (`Linking.openURL`,
 * deliberately not the in-app browser — the guest may want their signed-in
 * Google session, which lives in Chrome/Safari, not in our Custom Tab).
 *
 * The whole thing is absent when the server sends no rating, which is the
 * default state: no Place ID, or the ⛔ Places API key isn't configured.
 */
function RatingLine({ rating }: { rating: ApiRating }): React.ReactElement {
  const { t, lang } = useI18n();
  // "4.6" in English, "4,6" in German — the venue's score is a number the
  // guest reads, so it follows their language like every price does.
  const value = rating.value.toLocaleString(localeTag(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const count = rating.count.toLocaleString(localeTag(lang));
  return (
    <Pressable
      style={styles.ratingRow}
      onPress={() => void Linking.openURL(rating.reviewUrl).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={`${fill(t.ratingA11y, { value, count })} — ${t.ratingWriteReview}`}
      hitSlop={6}
    >
      <Text style={styles.ratingStar}>★</Text>
      <Text style={styles.ratingValue}>{value}</Text>
      <Text style={styles.ratingCount}>({count})</Text>
      <Text style={styles.ratingDot}>·</Text>
      <Text style={styles.ratingLink}>{t.ratingWriteReview}</Text>
    </Pressable>
  );
}

export function HomeScreen({
  menu,
  onAdd,
  onOpenCategory,
  onOpenOffers,
  onBrowseAll,
  onStartOrder,
  onOpenAccount,
  onOpenOwnerMenu,
  onMenuChanged,
}: {
  menu: ApiMenu;
  onAdd: (item: ApiItem) => void;
  onOpenCategory: (categoryId: string) => void;
  /** Opens the Menu tab with the Offers chip already chosen (P7-12). */
  onOpenOffers: () => void;
  onBrowseAll: () => void;
  onStartOrder: (type: "takeaway" | "delivery") => void;
  /** Switches to the Account tab, where the Rewards card lives. */
  onOpenAccount: () => void;
  /** Restaurant mode only: opens the burger's sheet. */
  onOpenOwnerMenu?: () => void;
  /** Turning a service off changes the published menu — the shell
   *  refetches it so every screen agrees. */
  onMenuChanged?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken } = useAuth();
  const restaurant = staffToken !== null;
  // Signed out, programme off, or nothing won yet ⇒ no banner at all.
  const { loyalty } = useLoyalty(menu.loyalty?.enabled);
  const voucher = headlineVoucher(loyalty);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [openDish, setOpenDish] = useState<ApiItem | null>(null);
  const popular = menu.categories
    .flatMap((c) => c.items)
    .filter((i) => i.isAvailable)
    .slice(0, 6);
  // The venue's live offers, as a destination rather than something to
  // be found by scrolling. Nothing about offers renders while the count
  // is 0 — no card, no empty state (P7-12).
  const offerCount = menu.offerCount ?? 0;
  const offerNames = offerItems(menu)
    .slice(0, 3)
    .map((i) => i.name)
    .join(" · ");
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={menu.venue.name} subtitle={t.restaurant} onMenu={onOpenOwnerMenu} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <HeroCarousel text={t.heroLine} />

        {/* What other guests think of this place, said once and quietly
            (P7-14). Nothing renders when the server sends no rating. */}
        {menu.rating ? <RatingLine rating={menu.rating} /> : null}

        {/* The counter's own controls: which services are taking orders
            right now. Guests never see this — they see the RESULT, as
            entry points that are simply there or not. */}
        {restaurant ? <ServiceSwitches onChanged={onMenuChanged} /> : null}

        {restaurant ? null : (
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
        )}

        {/* Table booking sits with the other ways to eat here — hidden
            entirely when the restaurant switched reservations off. */}
        {menu.ordering.reservations && !restaurant ? (
          <Pressable style={styles.reserveCard} onPress={() => setReserveOpen(true)}>
            <TableForGuestsIcon size={30} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modeTitle}>{t.reserveBtn}</Text>
              <Text style={styles.modeSub}>{t.reserveSub}</Text>
            </View>
            <Text style={styles.reserveChevron}>{CHEVRON_FORWARD}</Text>
          </Pressable>
        ) : null}

        {/* A reward already won is the one thing on this screen worth
            interrupting the browse for — gold-edged, above the
            categories, and gone the moment it's spent. */}
        {voucher ? (
          <Pressable style={styles.rewardBanner} onPress={onOpenAccount} accessibilityRole="button">
            <Text style={styles.rewardEmoji}>🎁</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.rewardTitle}>
                {fill(t.rewardsBanner, {
                  value: money(voucher.valueCents, menu.venue.currency),
                })}
              </Text>
              <Text style={styles.rewardCta}>{t.rewardsBannerCta}</Text>
            </View>
            <Text style={styles.reserveChevron}>{CHEVRON_FORWARD}</Text>
          </Pressable>
        ) : null}

        {/* Offers, between the hero and the categories: the one part of
            the menu with a reason to be looked at today. */}
        {offerCount > 0 && !restaurant ? (
          <Pressable
            style={styles.offersCard}
            onPress={onOpenOffers}
            accessibilityRole="button"
            accessibilityLabel={`${t.offersCardTitle} — ${
              offerCount === 1 ? t.offersCardCountOne : fill(t.offersCardCount, { n: offerCount })
            }`}
          >
            <Text style={styles.offersEmoji}>🔥</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.offersTitle}>
                {t.offersCardTitle} ·{" "}
                {offerCount === 1
                  ? t.offersCardCountOne
                  : fill(t.offersCardCount, { n: offerCount })}
              </Text>
              {offerNames ? (
                <Text style={styles.offersNames} numberOfLines={1}>
                  {offerNames}
                </Text>
              ) : null}
            </View>
            <Text style={styles.reserveChevron}>{CHEVRON_FORWARD}</Text>
          </Pressable>
        ) : null}

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
                  <Text style={{ ...fonts.body, fontSize: 24 }}>{cat.icon ?? "🍛"}</Text>
                </View>
              )}
              <Text style={styles.catName} numberOfLines={1}>
                {cat.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {restaurant ? null : (
          <>
            <SectionTitle action={t.showAll} onAction={onBrowseAll}>
              {t.popular}
            </SectionTitle>
            <View style={{ gap: 10 }}>
              {popular.map((item) => (
                <DishRow key={item.id} item={item} onAdd={onAdd} onOpen={setOpenDish} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <ReserveSheet menu={menu} visible={reserveOpen} onClose={() => setReserveOpen(false)} />
      <DishSheet item={openDish} onClose={() => setOpenDish(null)} onAdd={onAdd} />
    </View>
  );
}

/**
 * Pickup and delivery, as two switches the counter can reach in a second
 * — "the driver's off sick" is a thing that happens mid-service, and the
 * alternative is the owner finding a laptop.
 *
 * Both default ON: an older server that doesn't answer has turned
 * nothing off, and showing a service as dead when it isn't would cost
 * orders. Dine-in is deliberately absent — that is the QR menu on the
 * table, not something this screen switches.
 */
function ServiceSwitches({ onChanged }: { onChanged?: () => void }): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const [ordering, setOrdering] = useState<StaffOrdering>({
    dineIn: true,
    takeaway: true,
    delivery: true,
  });
  const [busy, setBusy] = useState<"takeaway" | "delivery" | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!staffToken) return;
    let alive = true;
    void fetchStaffOrdering(staffToken).then((res) => {
      if (!alive) return;
      if (res.ok) setOrdering(res.data);
      else if (res.error === "unauthorized") clearStaff();
      // Anything else: keep the optimistic "both on" — the switches still
      // work, and the first successful PATCH re-syncs them.
    });
    return () => {
      alive = false;
    };
  }, [staffToken, clearStaff]);

  const toggle = useCallback(
    async (key: "takeaway" | "delivery", next: boolean): Promise<void> => {
      if (!staffToken || busy) return;
      const before = ordering;
      setBusy(key);
      setFailed(false);
      setOrdering({ ...ordering, [key]: next });
      const res = await updateStaffOrdering(staffToken, { [key]: next });
      setBusy(null);
      if (!res.ok) {
        setOrdering(before);
        if (res.error === "unauthorized") clearStaff();
        else setFailed(true);
        return;
      }
      setOrdering(res.data);
      onChanged?.();
    },
    [staffToken, busy, ordering, clearStaff, onChanged],
  );

  return (
    <View style={styles.serviceCard}>
      <Text style={styles.serviceTitle}>{t.staffOrderingTitle}</Text>
      <View style={styles.serviceRow}>
        <ServiceSwitch
          emoji="🛍️"
          label={t.pickup}
          value={ordering.takeaway}
          busy={busy === "takeaway"}
          onChange={(next) => void toggle("takeaway", next)}
        />
        <ServiceSwitch
          emoji="🛵"
          label={t.delivery}
          value={ordering.delivery}
          busy={busy === "delivery"}
          onChange={(next) => void toggle("delivery", next)}
        />
      </View>
      {failed ? <Text style={styles.serviceError}>{t.staffToggleFailed}</Text> : null}
    </View>
  );
}

function ServiceSwitch({
  emoji,
  label,
  value,
  busy,
  onChange,
}: {
  emoji: string;
  label: string;
  value: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  return (
    <View style={styles.serviceSwitch}>
      <Text style={styles.serviceEmoji}>{emoji}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy}
        accessibilityLabel={label}
        trackColor={{ false: colors.line, true: colors.red }}
        thumbColor={colors.cream}
      />
      <Text style={styles.serviceLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 160, borderRadius: radius.lg, overflow: "hidden" },
  // Under the hero, above everything the guest can act on: a single
  // baseline of small type, with only the link carrying colour.
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 10,
    marginHorizontal: 2,
    minHeight: 32,
  },
  ratingStar: { color: colors.goldSoft, ...fonts.body, fontSize: 15 },
  ratingValue: { color: colors.ink, ...fonts.bodyBold, fontSize: 13.5 },
  ratingCount: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  ratingDot: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  ratingLink: {
    color: colors.red,
    ...fonts.bodyBold,
    fontSize: 13,
    textDecorationLine: "underline",
  },
  serviceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  serviceTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  serviceRow: { flexDirection: "row", alignItems: "flex-start", gap: 18 },
  serviceSwitch: { alignItems: "center", gap: 2 },
  serviceEmoji: { ...fonts.body, fontSize: 20 },
  serviceLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11 },
  serviceError: { color: colors.danger, ...fonts.bodySemi, fontSize: 12, width: "100%" },
  heroScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: scrim },
  // The scrim is an absolutely-positioned sibling, so the slides need to be
  // lifted above it explicitly — paint order alone doesn't settle it.
  heroScroll: { zIndex: 1 },
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
    zIndex: 2,
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
    ...fonts.bodyHeavy,
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
  reserveCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  reserveChevron: { color: colors.inkSoft, ...fonts.body, fontSize: 20 },
  rewardBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  rewardEmoji: { ...fonts.body, fontSize: 24 },
  // Reads as a sibling of the reward banner but in the brand red, not
  // gold: a reward is the guest's own, an offer is the house's.
  offersCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1.5,
    borderColor: colors.red,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  offersEmoji: { ...fonts.body, fontSize: 24 },
  offersTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14, lineHeight: 19 },
  offersNames: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  rewardTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14, lineHeight: 19 },
  rewardCta: { color: colors.gold, ...fonts.bodyBold, fontSize: 12 },
  modeEmoji: { ...fonts.body, fontSize: 26 },
  modeTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  modeSub: { color: colors.inkSoft, ...fonts.body, fontSize: 11 },
  catChip: { alignItems: "center", width: 72 },
  catPhoto: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.line },
  catFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.creamCard,
  },
  catName: { color: colors.ink, fontSize: 11, marginTop: 5, ...fonts.bodySemi },
});
