import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { ApiMenu, ApiItem } from "../api";
import { offerItems } from "../api";
import { useAuth } from "../auth";
import type { StaffHoursWeek, StaffOrdering } from "../staff";
import { fetchStaffHours, fetchStaffOrdering, updateStaffOrdering } from "../staff";
import { useVenueOpenNow, venueTimezone } from "../hours";
import { BrandHeader, DishRow, SectionTitle, VenueStatePill } from "../components";
import { CHEVRON_FORWARD, colors, fonts, hero, money, radius, scrim } from "../theme";
import { fill, useI18n } from "../i18n";
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

/**
 * The hero, and the venue's open/closed pill in its top-end corner.
 *
 * The pill used to own a second row of the red header — a full strip of
 * chrome for one word. It sits on the artwork now: same information,
 * same place a guest's eye lands first, no vertical cost. Three things
 * keep it out of the carousel's way:
 *
 * - it is an absolutely-positioned SIBLING of the pager, above both the
 *   slides (`zIndex: 1`) and the dots (`zIndex: 2`), and `elevation`
 *   repeats that for Android, which sorts by elevation before z;
 * - `pointerEvents="none"` (inside the pill) means a swipe that starts
 *   on it still pages the carousel — it is informational, never a
 *   target;
 * - `end: 12` rather than `right: 12`, so an RTL build mirrors it to
 *   the top-LEFT along with everything else.
 *
 * Nothing collides: the slide's headline is start-aligned and vertically
 * centred, the dots hug the bottom edge, and the dish is bottom-aligned
 * inside a hero that gained the 16 pt the pill's band needs.
 *
 * `openNow` stays three-state — `null` means nobody has told us, and
 * then there is no pill at all rather than a guessed "Closed", which
 * over a venue's own hero would cost it orders.
 */
function HeroCarousel({
  text,
  openNow,
}: {
  text: string;
  openNow: boolean | null;
}): React.ReactElement {
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
      {openNow === null ? null : <VenueStatePill open={openNow} style={styles.heroState} />}
    </ImageBackground>
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
  const { staffToken, clearStaff } = useAuth();
  const restaurant = staffToken !== null;
  /**
   * Behind the counter the hero's pill should be LIVE: the owner has
   * just edited the hours and wants to see what the change did, and the
   * menu payload this screen was handed may be minutes old. So
   * restaurant mode asks the hours route for the venue's own week —
   * `openNow`, the `hours` it was computed from, and the venue
   * `timezone`, which the public payload does not carry.
   */
  const [live, setLive] = useState<{
    openNow: boolean | null;
    hours: StaffHoursWeek | null;
    timezone: string | null;
  }>({ openNow: null, hours: null, timezone: null });
  useEffect(() => {
    if (!staffToken) {
      setLive({ openNow: null, hours: null, timezone: null });
      return;
    }
    let alive = true;
    void fetchStaffHours(staffToken).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setLive({ openNow: res.data.openNow, hours: res.data.hours, timezone: res.data.timezone });
      } else if (res.error === "unauthorized") clearStaff();
    });
    return () => {
      alive = false;
    };
  }, [staffToken, clearStaff]);

  /**
   * The pill, kept live between payloads.
   *
   * The SERVER still owns the hours and the zone; the device only
   * supplies the clock, ticking every 30 s so the pill flips within
   * sight of opening and closing time instead of freezing at whatever
   * the last fetch said (a tablet on the pass sat on one verdict all
   * evening). `openNowFor` returns nothing when the hours were never
   * configured or no venue timezone is known — then the server's own
   * `openNow` is the answer, exactly as before.
   *
   * Restaurant mode keeps preferring the staff route: its week is the
   * one the owner just saved, and its `timezone` is the venue's.
   */
  const timezone = venueTimezone(live.timezone, menu.venue.timezone);
  const openNow = useVenueOpenNow(
    live.hours ?? menu.venue.hours,
    timezone,
    live.openNow ?? menu.venue.openNow ?? null,
  );
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
      <BrandHeader
        title={menu.venue.name}
        subtitle={t.restaurant}
        onMenu={onOpenOwnerMenu}
        rating={menu.rating ?? null}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <HeroCarousel text={t.heroLine} openNow={openNow} />

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
  /** 176, not the old 160: the top ~36 pt are the pill's band now, and
   *  the extra 16 is what lets the dish keep its full size underneath it
   *  instead of being clipped into the corner the pill occupies. */
  hero: { height: 176, borderRadius: radius.lg, overflow: "hidden" },
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
  // Bottom-aligned inside the slide so the plate sits well clear of the
  // pill's band in the corner above it.
  heroDish: { width: 136, height: 124, alignSelf: "flex-end" },
  /** The open/closed pill, pinned into the hero's top-END corner: `end`
   *  rather than `right`, so an RTL build mirrors it to the left. Above
   *  the slides (z 1) and the dots (z 2) on both platforms — Android
   *  sorts by `elevation` first, hence both. */
  heroState: { position: "absolute", top: 12, end: 12, zIndex: 3, elevation: 4 },
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
