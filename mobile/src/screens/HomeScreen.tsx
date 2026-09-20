import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ApiMenu, ApiItem } from "../api";
import { offerItems } from "../api";
import { useAuth } from "../auth";
import type { StaffHoursWeek, StaffOrdering } from "../staff";
import { fetchStaffHours, fetchStaffOrdering, updateStaffOrdering } from "../staff";
import { useVenueOpenNow, venueTimezone } from "../hours";
import { BrandHeader, DishRow, PulsingBorder, SectionTitle, VenueStatePill } from "../components";
import { useFireFlicker, usePressScale } from "../motion";
import { CHEVRON_FORWARD, colors, fonts, hero, money, radius, scrim } from "../theme";
import { fill, useI18n } from "../i18n";
import { headlineVoucher, useLoyalty } from "../loyalty";
import type { GiftCardShop } from "../gift-cards";
import { fetchGiftCardShop } from "../gift-cards";
import { ReserveSheet } from "../reserve-sheet";
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
      {/* The hero's top-end corner. The points badge used to stack
          under this pill; it lives in the red header now, where it is
          on every screen rather than only this one — so the corner is
          back to the single piece of VENUE state it was built for. */}
      <View style={styles.heroBadges}>
        {openNow === null ? null : <VenueStatePill open={openNow} />}
      </View>
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
  onOpenGiftCards,
  onComplain,
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
  /** Opens the gift-card shop. Only reachable while the venue has the
   *  feature on and at least one active design (see `giftShop`). */
  onOpenGiftCards: () => void;
  /** Opens the complaint flow on the guest's most recent stored order,
   *  or explains that there isn't one yet. */
  onComplain: () => void;
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
  /**
   * The venue's gift-card shop window, read straight from the public
   * route rather than the menu payload (gift cards are not part of it).
   * Null until it answers, and `enabled` is already "switched on AND at
   * least one active design" — so the entry appears exactly when there
   * is something to buy, and nothing flashes in and out on a venue that
   * does not sell them.
   */
  const [giftShop, setGiftShop] = useState<GiftCardShop | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchGiftCardShop().then((shop) => {
      if (alive) setGiftShop(shop);
    });
    return () => {
      alive = false;
    };
  }, []);
  const giftCardsOn = !restaurant && Boolean(giftShop?.enabled);
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
  // Hooks cannot hang off `offerCount > 0`, so the flame's loop is built
  // whether or not there are offers; with no card to render it drives
  // nothing and costs one idle Animated value.
  const fire = useFireFlicker();
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader
        title={menu.venue.name}
        subtitle={t.restaurant}
        onMenu={onOpenOwnerMenu}
        rating={menu.rating ?? null}
        // `useLoyalty` already answers null when the guest is signed out
        // or the venue's programme is off, so the pill appears exactly
        // when there is a real balance to show — and never behind the
        // counter, where the burger owns this corner.
        points={!restaurant && loyalty ? loyalty.balance : null}
        onPoints={onOpenAccount}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <HeroCarousel text={t.heroLine} openNow={openNow} />

        {/* The counter's own controls: which services are taking orders
            right now. Guests never see this — they see the RESULT, as
            entry points that are simply there or not. */}
        {restaurant ? <ServiceSwitches onChanged={onMenuChanged} /> : null}

        {/* THE ACTION SET — four cards, one design.
            Delivery and Pickup are what a guest usually came for;
            Reserve and Gift cards are the two errands that are not an
            order. They used to be three different card styles (emoji,
            a bespoke SVG, an Ionicon), which read as three unrelated
            features stacked on top of each other. One plate, one icon
            family, one tinted circle — so the block reads as a set and
            the eye can pick a row rather than parse four things. */}
        {restaurant ? null : (
          <View style={styles.modeRow}>
            {menu.ordering.delivery ? (
              <ActionCard
                icon="bicycle-outline"
                title={t.delivery}
                subtitle={t.deliverySub}
                onPress={() => onStartOrder("delivery")}
              />
            ) : null}
            {menu.ordering.takeaway ? (
              <ActionCard
                icon="bag-handle-outline"
                title={t.pickup}
                subtitle={t.pickupSub}
                onPress={() => onStartOrder("takeaway")}
              />
            ) : null}
          </View>
        )}

        {/* Booking a table and buying a gift card — the second half of
            the same set. Either can be switched off by the venue
            (reservations from its settings, gift cards from the shop
            route), and whichever is left simply takes the whole row.
            Complaint used to live in this slot; it is a quiet full-width
            row further down now, because a guest with a problem should
            always be able to find the way to say so WITHOUT it competing
            with the four things people actually come here to do. */}
        {!restaurant && (menu.ordering.reservations || giftCardsOn) ? (
          <View style={styles.modeRow}>
            {menu.ordering.reservations ? (
              <ActionCard
                icon="restaurant-outline"
                title={t.reserveShort}
                subtitle={t.reserveSub}
                onPress={() => setReserveOpen(true)}
              />
            ) : null}
            {giftCardsOn ? (
              <ActionCard
                icon="gift-outline"
                title={t.giftCardsTitle}
                subtitle={t.giftCardsSub}
                onPress={onOpenGiftCards}
              />
            ) : null}
          </View>
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
            the menu with a reason to be looked at today — and the only
            card on this screen allowed to move, so the movement still
            means something. */}
        {offerCount > 0 && !restaurant ? (
          <Pressable
            style={styles.offersCard}
            onPress={onOpenOffers}
            accessibilityRole="button"
            accessibilityLabel={`${t.offersCardTitle} — ${
              offerCount === 1 ? t.offersCardCountOne : fill(t.offersCardCount, { n: offerCount })
            }`}
          >
            <PulsingBorder inset={2} style={styles.offersRing} />
            <Animated.Text style={[styles.offersEmoji, fire]}>🔥</Animated.Text>
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

        {/* "Complaint · About your last order" — one quiet full-width
            line under the offers, with a chevron like any other row that
            leads somewhere. Demoted from the action grid deliberately:
            it is a thing a guest needs to FIND, not a thing to invite
            them into, and it should not be the same size as ordering
            dinner. Still one tap, still always there. */}
        {restaurant ? null : (
          <Pressable
            onPress={onComplain}
            accessibilityRole="button"
            accessibilityLabel={`${t.complainShort} — ${t.complainSub}`}
            style={({ pressed }) => [styles.complainRow, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.inkSoft} />
            <Text style={styles.complainText} numberOfLines={1}>
              {t.complainShort} · {t.complainSub}
            </Text>
            <Text style={styles.reserveChevron}>{CHEVRON_FORWARD}</Text>
          </Pressable>
        )}

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
 * One of the four entry points at the top of Home.
 *
 * The whole point is that they are INTERCHANGEABLE: the icon in its
 * tinted circle, the display-serif title, one line of soft ink under
 * it, on the same plate at the same radius. Anything that made one card
 * special — an emoji here, a bespoke SVG there — made the block read as
 * four unrelated features rather than a set of four choices.
 *
 * Equal heights inside a row come from the flexed wrapper plus the
 * row's default `stretch`, not from a hard height: "Tisch reservieren"
 * wraps to two lines at 360 pt while "Abholung" does not, and a fixed
 * height would either clip one or pad the other.
 *
 * The press-back is the app's shared `usePressScale`, which returns a
 * still style and no-op handlers on a device with Reduce Motion on — the
 * `pressed` opacity below is then the whole feedback, which is what the
 * setting asks for.
 */
function ActionCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
}): React.ReactElement {
  const press = usePressScale(0.97);
  return (
    // The wrapper carries both the flex and the transform: a scale on
    // the card itself cannot make its sibling the same height.
    <Animated.View style={[styles.actionWrap, press.style]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${title} — ${subtitle}`}
        style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.actionIcon}>
          <Ionicons name={icon} size={22} color={colors.red} />
        </View>
        {/* Two lines allowed on every card, so a title that wraps in one
            language cannot make its neighbour a different height — and
            `adjustsFontSizeToFit` for the one word that still does not
            fit at 360 pt ("Geschenkgutscheine"), which would otherwise
            break mid-word and leave a line with one letter on it. */}
        <Text
          style={styles.actionTitle}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {title}
        </Text>
        <Text style={styles.actionSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </Pressable>
    </Animated.View>
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
  heroBadges: {
    position: "absolute",
    top: 12,
    end: 12,
    zIndex: 3,
    elevation: 4,
    gap: 6,
    // `flex-end` rather than `right`, so an RTL build mirrors the stack
    // to the top-left along with everything else in the hero.
    alignItems: "flex-end",
  },
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
  /** `stretch` (the default) is what makes the two cards in a row the
   *  same height whichever of them wraps. */
  modeRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  /** The flexed, animated wrapper — see `ActionCard`. */
  actionWrap: { flex: 1 },
  /**
   * The one plate all four entry points share: 16 pt radius, hairline
   * border, and a shadow soft enough to lift the card off the cream
   * without turning the row into a set of floating tiles. `height:
   * "100%"` is what makes the shorter card fill its stretched wrapper,
   * so the two borders line up exactly.
   */
  actionCard: {
    height: "100%",
    minHeight: 104,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  /** Brand red on a rose-tinted cream: the same warm family as the
   *  card, so the circle reads as part of the plate rather than a badge
   *  stuck on it. 44 pt, which is also the minimum touch target — handy,
   *  since the icon is the thing a thumb aims at. */
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f7e3dd",
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    color: colors.ink,
    ...fonts.display,
    fontSize: 14.5,
    lineHeight: 19,
    textAlign: "center",
  },
  actionSub: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5, textAlign: "center" },
  /** The demoted complaint row: a plate, not a card — no shadow, no
   *  tinted circle, muted ink. It is findable, not inviting. */
  complainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  complainText: { flex: 1, color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13 },
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
  // Reads as a sibling of the reward banner, but it is the one card that
  // pulses: a reward is the guest's own and will keep, an offer ends
  // tonight. The border itself is TRANSPARENT — `PulsingBorder` draws the
  // gold and the ember over it — and it is declared here anyway so the
  // card's box is the same 2 pt whether the ring is drawn or not.
  offersCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
    // Android's share of the glow. Its elevation shadow takes no colour
    // and would have to re-render the card's layer to breathe, so it is a
    // steady lift rather than a pulse — the ring is what carries the
    // movement there.
    elevation: 3,
  },
  /** The ring traces the card's OUTER edge, so it takes the outer radius. */
  offersRing: { borderRadius: radius.lg },
  offersEmoji: { ...fonts.body, fontSize: 24 },
  offersTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14, lineHeight: 19 },
  offersNames: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  rewardTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14, lineHeight: 19 },
  rewardCta: { color: colors.gold, ...fonts.bodyBold, fontSize: 12 },
  catChip: { alignItems: "center", width: 72 },
  catPhoto: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.line },
  catFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.creamCard,
  },
  catName: { color: colors.ink, fontSize: 11, marginTop: 5, ...fonts.bodySemi },
});
