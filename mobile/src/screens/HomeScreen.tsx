import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  ImageBackground,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { ApiHeroSlide, ApiMenu, ApiItem } from "../api";
import { offerItems } from "../api";
import { useAuth } from "../auth";
import type { StaffHoursWeek, StaffOrdering } from "../staff";
import { fetchStaffHours, fetchStaffOrdering, updateStaffOrdering } from "../staff";
import { useVenueOpenNow, venueTimezone } from "../hours";
import { BrandHeader, DishRow, PulsingBorder, SectionTitle, VenueStatePill } from "../components";
import { Grid } from "../responsive";
import { useLayout } from "../layout";
import { useFireFlicker, usePressScale } from "../motion";
import { CHEVRON_FORWARD, colors, fonts, hero, money, radius, scrim } from "../theme";
import { fill, useI18n } from "../i18n";
import { headlineVoucher, useLoyalty } from "../loyalty";
import type { GiftCardShop } from "../gift-cards";
import { fetchGiftCardShop } from "../gift-cards";
import { ReserveSheet, TableForGuestsIcon } from "../reserve-sheet";
import { displayVenueName, venueNameLines } from "../venue-name";
import { DishSheet } from "../dish-sheet";

/**
 * Start — the mockup's home: red brand header, artwork hero carousel,
 * the Lieferung/Abholung entry points, category medallions, popular
 * dishes.
 */

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
  photos,
}: {
  text: string;
  openNow: boolean | null;
  /** The owner's slides (Dashboard → Settings → App home slider). A dish
   *  keeps the classic slide — red artwork, headline, plate on the right;
   *  a banner is a finished poster, shown whole across the slide. Empty ⇒
   *  the plates bundled in the app. */
  photos: ApiHeroSlide[];
}): React.ReactElement {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  /**
   * The venue's slides, or — when it has none — ONE plain slide: the red
   * artwork and the welcome line, no image at all.
   *
   * That fallback used to be four cut-out plates bundled in the app,
   * 2.8 MB of PNG every guest downloaded with the binary whether their
   * venue showed them or not. The slider is posters now (owner,
   * 2026-09-22) and a poster is the venue's own artwork, which the app
   * cannot carry for it — so the empty case is the one slide that needs
   * no download rather than a set of stock dishes.
   */
  const slides: { source: ImageSourcePropType | null; kind: "dish" | "banner" }[] =
    photos.length > 0
      ? photos.map((p) => ({ source: { uri: p.url }, kind: p.kind }))
      : [{ source: null, kind: "dish" as const }];
  const count = slides.length;
  /**
   * With a banner in the set, the hero takes the posters' own 2 : 1 shape
   * so a poster fills the slide edge to edge with nothing cut off (owner,
   * 2026-09-22). Dish-only sets keep the classic 132 pt strip.
   */
  const hasBanner = slides.some((s) => s.kind === "banner");
  const heroHeight = hasBanner && width ? Math.round(width / 2) : undefined;
  // A different set of slides (the owner just added or removed one) must
  // not leave the pager parked past the new last page.
  const slidesKey = photos.map((p) => p.url).join("|");
  useEffect(() => {
    setPage(0);
    scroller.current?.scrollTo({ x: 0, animated: false });
  }, [slidesKey]);

  useEffect(() => {
    if (!width || count < 2) return;
    const id = setInterval(() => {
      setPage((current) => {
        const next = (current + 1) % count;
        scroller.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, 3500);
    return () => clearInterval(id);
  }, [width, count]);

  /**
   * How many slides may fetch their image yet.
   *
   * A poster is ~120 KB and the slider carries four of them; mounting
   * every `Image` at once puts half a megabyte on the wire at exactly
   * the moment the menu payload, the category medallions and the dish
   * photos are competing for it — on a phone outside the restaurant's
   * wifi that is the whole first impression. So the hero fetches the
   * slide on screen and the one after it, and reaches for the next only
   * as the pager gets there (which the 3.5 s rotation does on its own).
   * The empty slides keep their full width, so the paging arithmetic and
   * the dots are unchanged.
   */
  const [ready, setReady] = useState(2);
  useEffect(() => {
    setReady((current) => Math.max(current, page + 2));
  }, [page]);
  // A new set of slides starts the window over with the new first slide.
  useEffect(() => setReady(2), [slidesKey]);

  return (
    <ImageBackground
      source={hero}
      style={[styles.hero, heroHeight ? { height: heroHeight } : null]}
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
        {slides.map((slide, i) =>
          slide.kind === "banner" && slide.source ? (
            <View key={i} style={[styles.heroBannerSlide, width ? { width } : null]}>
              {/* The whole poster, edge to edge: the hero matches its 2 : 1
                  shape, so its headline and small print all show. */}
              {i < ready ? (
                <Image
                  source={slide.source}
                  style={styles.heroBanner}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : null}
            </View>
          ) : (
            <View key={i} style={[styles.heroSlide, width ? { width } : null]}>
              <Text style={styles.heroText}>{text}</Text>
              {slide.source ? (
                <Image
                  source={slide.source}
                  // The taller hero gets a bigger plate, so the slide isn't
                  // an empty red field around the same small dish.
                  style={[styles.heroDish, heroHeight ? styles.heroDishLarge : null]}
                  resizeMode="contain"
                />
              ) : null}
            </View>
          ),
        )}
      </ScrollView>
      {/* A pager with one page is not a pager: a lone dot reads as a
          control that does nothing. */}
      {count > 1 ? (
        <View style={styles.heroDots} pointerEvents="none">
          {Array.from({ length: count }, (_, i) => (
            <View key={i} style={[styles.heroDot, i === page && styles.heroDotActive]} />
          ))}
        </View>
      ) : null}
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
  onOpenPoints,
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
  /** Opens "My Points" — the header badge's destination. */
  onOpenPoints: () => void;
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
  // Tablet: the tiles and category medallions grow with the glass.
  const { wide } = useLayout();
  const emoji = [styles.modeEmoji, wide && styles.modeEmojiWide];
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
  // "Rangla Punjab Restaurant" in the header's title, "Konstanz" on the
  // line under it. The name comes from `displayVenueName`, not straight
  // off the payload: production still serves the shorter "Rangla Punjab
  // · Konstanz" and the owner's name for this restaurant is the longer
  // one. When the resolved name has no " · " in it, line 2 is null and
  // the header falls back to the all-caps "RESTAURANT" it has always
  // shown (see `venue-name.ts`).
  const venueLines = venueNameLines(displayVenueName(menu.venue.name));
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader
        title={venueLines.line1}
        // The one bar that carries the restaurant's own name, so the one
        // that sets it in the restaurant's own letters.
        sticker
        onMenu={onOpenOwnerMenu}
        rating={menu.rating ?? null}
        // `useLoyalty` already answers null when the guest is signed out
        // or the venue's programme is off, so the pill appears exactly
        // when there is a real balance to show — and never behind the
        // counter, where the burger owns this corner.
        // The POINTS badge shows wherever the venue runs the programme —
        // signed out too: the page it opens explains the rules and asks
        // them to sign in. Never behind the counter (the burger's corner).
        points={!restaurant && loyalty ? loyalty.balance : null}
        onPoints={!restaurant && menu.loyalty?.enabled ? onOpenPoints : undefined}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <HeroCarousel text={t.heroLine} openNow={openNow} photos={menu.venue.heroSlides ?? []} />

        {/* The counter's own controls: which services are taking orders
            right now. Guests never see this — they see the RESULT, as
            entry points that are simply there or not. */}
        {restaurant ? <ServiceSwitches onChanged={onMenuChanged} /> : null}

        {/* THE ACTION SET — a 3-UP GRID: six cells, two rows, every cell
            the same 58 pt tile of icon-over-label.

            Three to a row rather than two, at the owner's word: with two
            the six entries needed three rows and pushed "Categories" off
            the bottom of a 360×800 phone, which is the one thing this
            screen must not do — the categories ARE the menu. Two rows of
            three plus a shorter hero put the category chips back above
            the fold without scrolling.

            Row A is what a guest usually came for (order, or book a
            table); row B is the three errands that are not an order.
            Anything the venue switches off simply leaves its row — the
            cells are `flexBasis: 0 / flexGrow: 1`, so two survivors split
            the row in halves and one takes it whole (see `actionCard`).

            The icons are the app's OWN: the scooter and the bag the guest
            has always tapped, and the house's table SVG on the reserve
            card. A pass at replacing them with one outline icon family in
            tinted circles was taken back out at the owner's word.

            The subtitles are not on the cards at this size — there is no
            room for a second line — but they are not lost: each one is
            still spoken as part of the cell's `accessibilityLabel`. */}
        {restaurant ? null : (
          <>
            {menu.ordering.delivery || menu.ordering.takeaway || menu.ordering.reservations ? (
              <View style={styles.modeRow}>
                {menu.ordering.delivery ? (
                  <ActionCard
                    icon={<Text style={emoji}>🛵</Text>}
                    title={t.delivery}
                    subtitle={t.deliverySub}
                    onPress={() => onStartOrder("delivery")}
                  />
                ) : null}
                {menu.ordering.takeaway ? (
                  <ActionCard
                    icon={<Text style={emoji}>🛍️</Text>}
                    title={t.pickup}
                    subtitle={t.pickupSub}
                    onPress={() => onStartOrder("takeaway")}
                  />
                ) : null}
                {menu.ordering.reservations ? (
                  <ActionCard
                    icon={<TableForGuestsIcon size={wide ? 32 : 18} />}
                    title={t.reserveShort}
                    subtitle={t.reserveSub}
                    onPress={() => setReserveOpen(true)}
                  />
                ) : null}
              </View>
            ) : null}

            {/* Row B. Complaint is always here, whatever else is on: a
                guest with a problem must always be able to find the way
                to say so. Offers is the only cell on this screen allowed
                to move, so the movement still means something, and it is
                absent entirely when the count is 0 (P7-12). */}
            <View style={styles.modeRow}>
              {giftCardsOn ? (
                <ActionCard
                  icon={<Text style={emoji}>🎁</Text>}
                  title={t.giftCardsTitle}
                  subtitle={t.giftCardsSub}
                  onPress={onOpenGiftCards}
                />
              ) : null}
              {offerCount > 0 ? (
                <OffersCard count={offerCount} names={offerNames} onPress={onOpenOffers} />
              ) : null}
              <ActionCard
                icon={<Text style={emoji}>💬</Text>}
                title={t.complainShort}
                subtitle={t.complainSub}
                onPress={onComplain}
              />
            </View>
          </>
        )}

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

        <SectionTitle action={t.showAll} onAction={onBrowseAll}>
          {t.categories}
        </SectionTitle>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 14 }}
        >
          {menu.categories.map((cat) => (
            <Pressable
              key={cat.id}
              style={[styles.catChip, wide && styles.catChipWide]}
              onPress={() => onOpenCategory(cat.id)}
            >
              {cat.photoUrl ? (
                <Image
                  source={{ uri: cat.photoUrl }}
                  style={[styles.catPhoto, wide && styles.catPhotoWide]}
                />
              ) : (
                <View style={[styles.catPhoto, wide && styles.catPhotoWide, styles.catFallback]}>
                  <Text style={{ ...fonts.body, fontSize: wide ? 34 : 24 }}>
                    {cat.icon ?? "🍛"}
                  </Text>
                </View>
              )}
              <Text style={[styles.catName, wide && styles.catNameWide]} numberOfLines={1}>
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
            <Grid>
              {popular.map((item) => (
                <DishRow key={item.id} item={item} onAdd={onAdd} onOpen={setOpenDish} />
              ))}
            </Grid>
          </>
        )}
      </ScrollView>
      <ReserveSheet menu={menu} visible={reserveOpen} onClose={() => setReserveOpen(false)} />
      <DishSheet item={openDish} onClose={() => setOpenDish(null)} onAdd={onAdd} />
    </View>
  );
}

/**
 * One of the entry points at the top of Home.
 *
 * ONE CELL OF THE 3-UP GRID: a 58 pt tile, icon over label, three to a
 * row. It has been through two shapes on the way here — 88 pt vertical
 * tiles with subtitles, then 44 pt horizontal strips — and both lost to
 * the same measurement: six entries have to leave the category chips
 * visible on a 360×800 phone without scrolling. Three columns is what
 * finally does it, and it is why the layout is back to vertical: at a
 * third of the row there is no width for an icon AND a label side by
 * side.
 *
 * The SUBTITLE is not on the card — but it is not lost: it is still in
 * `accessibilityLabel`, so a screen reader hears "Lieferung — in 30–45
 * Minuten bei dir" exactly as it always did. What is dropped is a line
 * of 11 pt grey that sighted guests were not reading.
 *
 * The icon is still BARE — the emoji the card has always had, or the
 * house's own table SVG on the reserve card — on the plain cream plate
 * with its hairline border. No tinted circle, no display serif: those
 * were a redesign the owner asked to be taken back out. The caller
 * passes the icon as a node, so an emoji and an SVG can sit in the same
 * set without the card knowing which it holds.
 *
 * Equal heights inside a row still come from the row's `stretch` plus a
 * card that only ever GROWS into it, never from a stated height — the
 * rule survives every reshaping because the reason for it does:
 * "Geschenkgutscheine" takes two lines at a third of 360 pt where
 * "Abholung" takes one, and a fixed height would either clip the first
 * or pad the second. A percentage height is worse than either — see
 * `styles.actionCard`.
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
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}): React.ReactElement {
  const press = usePressScale(0.97);
  const { wide } = useLayout();
  return (
    // The wrapper carries the row's horizontal flex and the press
    // transform; it states no height of its own, so the row's `stretch`
    // is the single thing that decides how tall the pair is.
    <Animated.View style={[styles.actionWrap, press.style]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${title} — ${subtitle}`}
        style={({ pressed }) => [
          styles.actionCard,
          wide && styles.actionCardWide,
          pressed && { opacity: 0.9 },
        ]}
      >
        <View style={[styles.actionIcon, wide && styles.actionIconWide]}>{icon}</View>
        {/* TWO lines allowed, because a third of a 360 pt row is ~103 pt
            of usable width and "Geschenkgutscheine" cannot be had on one
            line at any size worth reading. `adjustsFontSizeToFit` stays
            as the shrink-before-truncate net for the words that do not
            fit even two lines. */}
        <Text
          style={[styles.actionTitle, wide && styles.actionTitleWide]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Offers — the left half of the row, an `ActionCard` that is allowed to
 * burn.
 *
 * It is deliberately the SAME cell as its neighbours: the wrapper, the
 * plate, the icon band and the label are `ActionCard`'s own styles, so
 * the three tiles in the row line up exactly. Only three things are
 * added, and each is the reason this cell exists rather than decoration
 * — the ember ring, the flicker on the flame, and the live count.
 *
 * The overrides it needs on top of `actionCard`: a 2 pt TRANSPARENT
 * border, because `PulsingBorder` is an absolutely-positioned sibling
 * whose `inset={2}` resolves against the parent's padding edge — the
 * ring then lands exactly on the border box and the tiles' outer edges
 * stay flush. It states no height, for the same reason `actionCard`
 * doesn't.
 *
 * The COUNT is a BADGE in the corner, not words in the label. At a third
 * of a 360 pt row "Angebote · 3 Gerichte" wrapped to two lines and shrank
 * to the font floor, and the first thing to become unreadable was the
 * number — the one part of this tile that changes. As a gold pill it is
 * read first and the label is free to be the single word. The offer NAMES
 * have no room at this size either; they ride the `accessibilityLabel`
 * with the count, where nothing is lost.
 */
function OffersCard({
  count,
  names,
  onPress,
}: {
  count: number;
  names: string;
  onPress: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  // 1.1, not the default 1.15: the grid's icon band is 22 pt and the
  // bigger swell pushes the flame's box into the label under it.
  const fire = useFireFlicker(1.1);
  const press = usePressScale(0.97);
  const { wide } = useLayout();
  const countLabel = count === 1 ? t.offersCardCountOne : fill(t.offersCardCount, { n: count });
  return (
    <Animated.View style={[styles.actionWrap, press.style]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={
          names
            ? `${t.offersCardTitle} — ${countLabel} — ${names}`
            : `${t.offersCardTitle} — ${countLabel}`
        }
        style={({ pressed }) => [
          styles.actionCard,
          wide && styles.actionCardWide,
          styles.offersCard,
          pressed && { opacity: 0.9 },
        ]}
      >
        <PulsingBorder inset={2} style={styles.offersRing} />
        {/* The count, as a pill in the corner. Hidden from the reader —
            the Pressable's own label already says "3 Angebote" in words,
            and a bare "3" read out after it is noise. */}
        <View
          style={styles.offersCount}
          accessibilityElementsHidden
          importantForAccessibility="no"
          pointerEvents="none"
        >
          <Text style={styles.offersCountText}>{count}</Text>
        </View>
        {/* The flame sits in the same bare icon band as its neighbours'
            emoji, so the row reads as three tiles of one family — what
            marks this one out is that the flame MOVES. */}
        <View style={[styles.actionIcon, wide && styles.actionIconWide]}>
          <Animated.Text style={[styles.offersEmoji, wide && styles.modeEmojiWide, fire]}>
            🔥
          </Animated.Text>
        </View>
        <Text
          style={[styles.actionTitle, wide && styles.actionTitleWide]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {t.offersCardTitle}
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
  /** 132, down from 176. The hero is the biggest single thing between
   *  the header and the categories, and the owner's ask — category chips
   *  visible without scrolling on a 360×800 phone — is bought as much
   *  here as in the action grid. The top ~34 pt are still the open/closed
   *  pill's band; what came off is the air under the dish. */
  hero: { height: 132, borderRadius: radius.lg, overflow: "hidden" },
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  // Cut-out plates float straight on the artwork — no frame, no white box.
  // Bottom-aligned inside the slide so the plate sits well clear of the
  // pill's band in the corner above it.
  heroDish: { width: 100, height: 92, alignSelf: "flex-end" },
  heroDishLarge: { width: 140, height: 128 },
  heroBannerSlide: { height: "100%" },
  // Exactly the slide's box: the hero is 2 : 1 whenever a banner is in
  // the set, the same shape as the posters, so `cover` crops nothing.
  heroBanner: { width: "100%", height: "100%" },
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
  /** `alignItems: "stretch"` — written out rather than left to the
   *  default — is what makes the two cards in a row the same height
   *  whichever of them wraps. It is the ONLY vertical coupling in this
   *  row: nothing here may set a height, least of all a percentage one
   *  (see `actionCard`). */
  modeRow: { flexDirection: "row", alignItems: "stretch", gap: 8, marginTop: 8 },
  /**
   * The flexed, animated wrapper — see `ActionCard`.
   *
   * `flexBasis: 0 / flexGrow: 1 / flexShrink: 1` rather than the `flex: 1`
   * shorthand, to say explicitly that the flexing is HORIZONTAL: this is a
   * child of a `row`, so the basis is a width. The wrapper never states a
   * height — it inherits one from the row's `stretch`, and the card inside
   * grows into it.
   */
  actionWrap: { flexBasis: 0, flexGrow: 1, flexShrink: 1 },
  /**
   * The one plate all four entry points share: 16 pt radius, hairline
   * border, and a shadow soft enough to lift the card off the cream
   * without turning the row into a set of floating tiles.
   *
   * `flexGrow: 1` with the DEFAULT `flexBasis: auto` is what makes the
   * shorter card fill its stretched wrapper so the two borders line up:
   * the card measures itself from its content first and only then grows
   * into whatever slack the row's `stretch` handed the wrapper. It can
   * therefore never be taller than its row-mate, and never shorter.
   *
   * What must NOT come back is `height: "100%"`. On the web build that
   * resolves against a flex item the browser has already stretched, so it
   * is a no-op; under Yoga the wrapper's height is still indefinite when
   * the percentage is resolved, and the card inflated to the height of the
   * whole scroll content — two ~900 pt blanks with their contents centred
   * somewhere off the bottom of the screen. Same for `flex: 1` here: its
   * implied `flexBasis: 0` throws the content measurement away and leaves
   * the height to whatever slack happens to exist.
   */
  actionCard: {
    flexGrow: 1,
    /** 58: an 18 pt icon band, two 14 pt label lines and 6 pt of padding
     *  top and bottom. A FLOOR, not a fixed height, so a guest running
     *  larger system text gets a taller tile rather than a clipped one —
     *  and the row's `stretch` then lifts its neighbours to match.
     *
     *  Below the 44 pt touch minimum this would be a problem; at 58 the
     *  tile is comfortably past it in both directions. */
    minHeight: 58,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    /** `md`, not `lg`: a 16 pt radius on a 103 pt tile eats the corners
     *  the label needs. */
    borderRadius: radius.md,
    /** The plate is unchanged: a hairline border and NO shadow. Only the
     *  padding shrank with the tile — and `horizontal` is down to 4,
     *  because at a third of a 360 pt row every point of it comes
     *  straight off the label's measure. */
    paddingHorizontal: 4,
    paddingVertical: 6,
    /** ICON OVER LABEL, both centred. At a third of the row there is no
     *  width for the two side by side. */
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  /** The icon, bare — no circle behind it. The slot survives every
   *  reshaping because its reason does: an 18 pt SVG (reserve) and an
   *  emoji (everything else) have different line boxes, and without a
   *  fixed slot the reserve tile's label would sit a couple of points
   *  below its row-mates'. 22 is the emoji's line box at the new size
   *  (see `modeEmoji`), and it is a FLOOR, so larger system text grows
   *  the band instead of clipping the glyph. */
  actionIcon: { minHeight: 22, alignItems: "center", justifyContent: "center" },
  /** Bold BODY face at 12 over two lines. Centred explicitly, because a
   *  label that wraps would otherwise set itself against the start edge
   *  inside a centred tile. `lineHeight` is stated so the 58 pt floor is
   *  arithmetic rather than a guess about Nunito's ascenders per
   *  platform: 22 + 3 + 2×14 + 12 padding = 65 for a two-line label,
   *  which is what the row settles at. */
  actionTitle: {
    color: colors.ink,
    ...fonts.bodyBold,
    fontSize: 12,
    lineHeight: 14,
    textAlign: "center",
  },
  /** Delivery 🛵, Pickup 🛍️, Gift cards 🎁, Complaint 💬 — the app's own
   *  glyphs, down to 18 with the tile. `lineHeight` is stated so the box
   *  an emoji occupies is the same on web as on the devices, which is
   *  what `actionIcon`'s 22 is measured from. */
  modeEmoji: { ...fonts.body, fontSize: 18, lineHeight: 22 },
  // Tablet sizes. A third of a 1032 pt row is ~330 pt: at phone sizes the
  // icon and label sat in the middle of a mostly empty plate.
  modeEmojiWide: { fontSize: 32, lineHeight: 38 },
  actionCardWide: { minHeight: 96, paddingVertical: 14 },
  actionIconWide: { minHeight: 38 },
  actionTitleWide: { fontSize: 16, lineHeight: 20 },
  catChipWide: { width: 100 },
  catPhotoWide: { width: 84, height: 84, borderRadius: 42 },
  catNameWide: { fontSize: 14, marginTop: 7 },
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
  /**
   * What the Offers card adds to `actionCard` — nothing about the box's
   * SIZE, only its edge.
   *
   * The border is 2 pt and TRANSPARENT: `PulsingBorder` draws the gold and
   * the ember over it, and the width is declared whether or not the ring
   * is drawn so the card's outer edge stays flush with its row-mate's (the
   * ring's `inset={2}` resolves against this padding edge).
   *
   * `elevation` is Android's share of the glow. Its elevation shadow takes
   * no colour and would have to re-render the card's layer to breathe, so
   * it is a steady lift rather than a pulse — the ring carries the
   * movement there.
   */
  offersCard: { borderWidth: 2, borderColor: "transparent", elevation: 3 },
  /** The ring traces the card's OUTER edge, so it takes the outer radius. */
  offersRing: { borderRadius: radius.lg },
  /** 16 — a shade under its neighbours' 18, because the flicker scales it
   *  at the top of its cycle and the 22 pt icon slot has to hold that
   *  without nudging the label. */
  offersEmoji: { ...fonts.body, fontSize: 16, lineHeight: 22 },
  /**
   * The live count, as a small gold pill in the tile's top-END corner
   * rather than words in the label.
   *
   * "Angebote · 3 Gerichte" did not survive the 3-up grid: at a third of
   * a 360 pt row it wrapped to two lines and shrank to the floor, and
   * what got lost was the number — the one part of this tile that
   * changes. As a badge it is the first thing read instead, and the
   * label is free to be the single word "Angebote".
   *
   * `end`/`zIndex` rather than `right`: an RTL build mirrors the corner
   * with everything else, and the pill has to clear the pulsing ring
   * that is drawn over the same box.
   */
  offersCount: {
    position: "absolute",
    top: 3,
    end: 3,
    zIndex: 2,
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.goldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  offersCountText: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 10, lineHeight: 13 },
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
