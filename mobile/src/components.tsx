import React from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, isRTL, money, radius, statusTones } from "./theme";
import { HalalMark } from "./halal-mark";
import { CartoonTitle } from "./cartoon-title";
import { VenueWordmark } from "./venue-wordmark";
import { ALLERGEN_ICONS, DIET_ICONS, fill, localeTag, useI18n } from "./i18n";
import { useBumpOnChange, usePressScale, usePulse } from "./motion";
import type { ApiItem, ApiRating } from "./api";

/**
 * A form field's label, with the asterisk when the field is REQUIRED.
 *
 * The mark is the same everywhere — guest forms, owner forms, sheets —
 * because "which of these must I fill in" is a question a person should
 * only have to learn the answer to once. Colour is never the only
 * signal: the asterisk is a visible glyph, and the accessibility label
 * says the word, so a screen reader announces "Phone, required" rather
 * than reading a star out of context.
 *
 * `style` takes the HOST screen's own label style (each screen sizes its
 * labels differently); the asterisk keeps its accent regardless.
 */
export function FieldLabel({
  label,
  required = false,
  style,
}: {
  label: string;
  required?: boolean;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <Text style={style} accessibilityLabel={required ? `${label}, ${t.fieldRequired}` : label}>
      {label}
      {required ? (
        <Text
          style={styles.requiredMark}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {" *"}
        </Text>
      ) : null}
    </Text>
  );
}

/** The one line that explains the asterisks. Shown once per form that
 *  has at least one required field, never on a form without any. */
export function RequiredLegend({ style }: { style?: StyleProp<TextStyle> }): React.ReactElement {
  const { t } = useI18n();
  return <Text style={[styles.requiredLegend, style]}>{t.fieldRequiredLegend}</Text>;
}

/**
 * Red screen header with the brand mark — the mockup's top bar.
 *
 * The two optional slots belong to RESTAURANT MODE: a burger at the end
 * that opens the owner's menu, and a back arrow in the start rail on
 * the screens that aren't tabs. A guest build passes neither, so the bar
 * is exactly the mockup's.
 *
 * The open/closed pill is NOT here any more. It had a second header row
 * to itself, which cost every screen a strip of red for one word; it now
 * rides the Home hero's top-end corner, where it sits over the artwork
 * and costs no vertical space at all (see `VenueStatePill`, exported for
 * exactly that). The header is back to a single row.
 *
 * THREE STACKED LINES, all centred on one axis: the venue's name, its
 * town, and its Google rating. They were briefly two — the town and the
 * rating sharing a row — and the owner asked for them apart, which is
 * also the better reading: "Konstanz" is part of the NAME (the second
 * half of "Rangla Punjab Restaurant · Konstanz", see `venue-name.ts`),
 * and hanging it off the front of a tappable rating made it look like
 * part of the link. Now the name owns lines 1–2 and the rating owns
 * line 3, which is the only tappable one of the three.
 *
 * The subtitle is no longer the all-caps "RESTAURANT" it started as,
 * though a venue whose name has no " · " in it still falls back to that
 * word; either way it renders on its own line whether or not a rating is
 * there.
 *
 * The side slots are NOT in that column: the back arrow stays pinned to the
 * start edge and the owner's burger to the end edge, as they always
 * were, so the centred text keeps symmetric gutters no matter which of
 * them is present.
 *
 * EVERY screen's bar is the SAME height. The content area is pinned to
 * `HEADER_CONTENT_HEIGHT` (safe-area padding sits above it, in
 * `App.tsx`), measured off the tallest case there is — all three lines.
 * A screen that passes only a title gets the same slab with more air in
 * it, so moving between Home, Menu, Cart and Orders never makes the red
 * jump. That rule predates the third line and survives it. The title is
 * deliberately single-line (`numberOfLines={1}` + `adjustsFontSizeToFit`):
 * letting a long venue name wrap is the other way the height used to
 * drift.
 */
export function BrandHeader({
  title,
  sticker = false,
  onMenu,
  onBack,
  rating,
  points,
  onPoints,
}: {
  title: string;
  /**
   * Set the title in the venue's own STICKER lettering (lime, outlined —
   * `CartoonTitle`) instead of the app's heading face.
   *
   * Only the screens that put the RESTAURANT'S NAME in the bar pass it
   * (owner, 2026-09-22). "Cart", "Orders" and the rest stay in Nunito:
   * the lettering is the venue's signature, and a signature that is on
   * every word means nothing. The bar's height does not depend on it —
   * `HEADER_CONTENT_HEIGHT` is the sticker case either way — so a guest
   * moving between tabs never sees the red slab change size.
   */
  sticker?: boolean;
  onMenu?: () => void;
  onBack?: () => void;
  /** The venue's Google rating, on the screens that carry its name. */
  rating?: ApiRating | null;
  /**
   * The signed-in guest's points balance, shown as a small pill in the
   * header's end corner. Null — signed out, no programme, restaurant
   * mode — means no pill at all, which is the default.
   *
   * It lives here rather than on the Home hero (where it started)
   * because the balance is about the GUEST, not about this screen: the
   * header is the one strip that is on every screen, so the number
   * follows them instead of being something they have to go back to
   * Home to see.
   */
  points?: number | null;
  /** Opens the Account screen's rewards card — the only place the
   *  number means anything. */
  onPoints?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  /** The middle slot's measured width — what the name is fitted to. */
  const [center, setCenter] = React.useState(0);
  return (
    <View style={styles.headerWrap}>
      <View style={styles.header}>
        {/* Start slot: the back arrow, or the mascot in its place. The
            mascot is the CUT-OUT — no cream medallion behind it (owner,
            2026-09-22) — and the rail is always its 44 pt, whether or not
            anything is in it, because that reserve is what keeps the
            venue's name centred on the BAR rather than on whatever is
            left of it. */}
        <View style={styles.headerStart}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.back}
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
            >
              {/* Ionicons don't mirror themselves: pick the arrow that points
                  "back" in the current reading direction. */}
              <Ionicons
                name={isRTL ? "arrow-forward" : "arrow-back"}
                size={22}
                color={colors.onRed}
              />
            </Pressable>
          ) : (
            <Image source={LOGO_CUTOUT} style={styles.headerLogo} resizeMode="contain" />
          )}
        </View>
        <View style={styles.headerCenter} onLayout={(e) => setCenter(e.nativeEvent.layout.width)}>
          {/* The venue's name as the poster LOCKUP — "RANGLA PUNJAB" over
              a smaller "RESTAURANT" — the same mark the launch screen
              sets (owner, 2026-09-22).

              It is fitted to the MEASURED middle slot rather than to a
              guess: this bar's centre is what is left after two 44 pt
              side slots, two 8 pt gaps and the 16 pt insets, and the
              points pill widens its slot to 110. `CartoonTitle` scales
              the whole lettering to whatever that leaves, so a long name
              shrinks instead of being clipped — `adjustsFontSizeToFit`
              can't help here, an SVG has no such affordance. Until the
              first layout the cap is the narrowest case, so the name is
              never drawn too wide and then snapped back. */}
          {sticker ? (
            <VenueWordmark
              name={title}
              // Past any phone's middle slot on purpose: `maxWidth` does
              // the sizing, so the mark always spans the room the two
              // rails leave it instead of sitting at a fixed size with
              // air either side (owner, 2026-09-22 — "stretch the name").
              size={60}
              maxWidth={Math.min(center > 0 ? center : HEADER_TITLE_MIN, HEADER_TITLE_MAX)}
            />
          ) : (
            <Text
              style={styles.headerTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {title}
            </Text>
          )}
          {rating ? <HeaderRatingLine rating={rating} /> : null}
        </View>
        {/* End slot: the burger, pinned to the TOP corner of the content
            area rather than centred on it. The slot itself is always
            there — an empty one on the screens without a burger — so the
            centred title keeps symmetric gutters either way. */}
        <View style={[styles.headerEnd, onPoints && styles.headerEndCentred]}>
          {onPoints ? <HeaderPointsPill points={points ?? null} onPress={onPoints} /> : null}
          {onMenu ? (
            <Pressable
              onPress={onMenu}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.ownerMenuOpen}
              style={({ pressed }) => [styles.headerMenuBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="menu" size={26} color={colors.onRed} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * The POINTS badge in the header's end corner (owner's mock, 2026-09-22):
 * a white rounded card with the gift, the word in the sticker lettering
 * (`CartoonTitle`) — it opens "My Points". Compact (owner, 2026-09-22):
 * no chevron, small gift, so it sits inside the header's corner.
 *
 * No number on the badge itself, as in the mock; the balance is the first
 * thing the page it opens shows, and the spoken label still carries it
 * ("Your points: 35") whenever it is known. A real button: the 44 pt
 * card plus hitSlop clears the touch target.
 *
 * It pops when the BALANCE moves and only then (`useBumpOnChange`, which
 * sits out a reduced-motion device entirely).
 */
function HeaderPointsPill({
  points,
  onPress,
}: {
  points: number | null;
  onPress: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const bump = useBumpOnChange(points ?? 0);
  return (
    <Animated.View style={bump}>
      <Pressable
        onPress={onPress}
        // The badge's own box is ~23 pt tall now, so the slop is what
        // carries it past the 44 pt target WCAG 2.5.5 asks for: 23 + 2×12
        // = 47 vertically, and the same idea sideways.
        hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={
          points === null ? t.pointsScreenTitle : fill(t.pointsBadgeLabel, { points })
        }
        style={({ pressed }) => [styles.headerPoints, pressed && { opacity: 0.8 }]}
      >
        {/* A gift in the venue's own red, not the platform's emoji: 🎁 is
            drawn by whatever font the OS ships and changed size, colour
            and even shape between iOS and Android. A vector glyph is one
            picture everywhere and takes the brand's colour. */}
        <View style={styles.headerPointsBody}>
          <Ionicons name="gift" size={15} color={colors.red} />
          {/* `maxWidth` rather than a smaller size: the word is set as big
              as the square can hold and shrinks itself to fit, so the
              badge stays square whatever the language calls points. */}
          <CartoonTitle text={t.pointsBadgeWord} size={9} maxWidth={POINTS_BADGE - 10} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * "★ 4,7 (440) · Bewertung schreiben" — the venue's Google rating, on
 * the line under its name in the red header.
 *
 * The WHOLE line is the target, not just the words at the end: a guest
 * who wants to leave a review aims at the stars. It is a single
 * Pressable with its own vertical padding plus hitSlop, so the tappable
 * box clears 44 pt even though the type is 12 pt.
 *
 * Tapping opens Google's own review form in the SYSTEM browser
 * (`Linking.openURL`, deliberately not the in-app browser — the guest
 * wants their signed-in Google session, which lives in Chrome/Safari,
 * not in our Custom Tab). `api.ts` has already refused any URL that
 * isn't plain http(s), so nothing app-scheme-shaped reaches the OS.
 *
 * Colours come from the header's own two light tones, measured against
 * the brand red: `onRed` at 8.2:1 carries the number and the link,
 * `goldSoft` at 5.7:1 the star, the count and the separator — both past
 * AA for the size, and the link keeps its underline so it is not colour
 * alone that says "tap me".
 */
function HeaderRatingLine({ rating }: { rating: ApiRating }): React.ReactElement {
  const { t, lang } = useI18n();
  // "4.7" in English, "4,7" in German — the venue's score is a number
  // the guest reads, so it follows their language like every price does.
  const value = rating.value.toLocaleString(localeTag(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const count = rating.count.toLocaleString(localeTag(lang));
  return (
    <Pressable
      onPress={() => void Linking.openURL(rating.reviewUrl).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={`${fill(t.ratingA11y, { value, count })} — ${t.ratingWriteReview}`}
      hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
      style={({ pressed }) => [styles.headerRating, pressed && { opacity: 0.7 }]}
    >
      {/* `row` mirrors itself in an RTL build, so the star leads the
          line in whichever direction the guest reads. */}
      <Text style={styles.headerRatingStar}>★</Text>
      <Text style={styles.headerRatingValue}>{value}</Text>
      <Text style={styles.headerRatingCount}>({count})</Text>
      <Text style={styles.headerRatingCount}>·</Text>
      <Text style={styles.headerRatingLink} numberOfLines={1}>
        {t.ratingWriteReview}
      </Text>
    </Pressable>
  );
}

/**
 * Open or closed, said in three ways at once: a coloured dot, a filled
 * pill, and the WORD. The word is what makes it work for someone who
 * cannot tell the dots apart — colour is never carrying the meaning on
 * its own here.
 *
 * The pill has its own OPAQUE light fill rather than sitting bare on
 * whatever is behind it: green-on-brand-red would not clear AA, and now
 * that it lives on the Home hero it may be over a bright photograph as
 * easily as a dark one. The fill is what makes the contrast a known
 * quantity — the text is measured against the fill, never against the
 * backdrop. The hairline outline keeps the pill's own edge visible when
 * the artwork behind it happens to be pale too.
 *
 * `style` is the caller's slot for placement (the hero pins it into its
 * top-end corner); the pill itself stays layout-agnostic. It is purely
 * informational, so it never takes touches — `pointerEvents="none"`
 * hands every swipe straight through to the carousel underneath.
 */
export function VenueStatePill({
  open,
  style,
}: {
  open: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { t } = useI18n();
  const tone = open ? statusTones.open : statusTones.closed;
  const label = open ? t.venueOpen : t.venueClosed;
  return (
    <View
      style={[styles.statePill, { backgroundColor: tone.fill }, style]}
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {/* Decorative: the label beside it already says this. */}
      <View style={[styles.stateDot, { backgroundColor: tone.dot }]} />
      <Text style={[styles.stateText, { color: tone.text }]} numberOfLines={1}>
        {label}
      </Text>
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
  busyLabel,
  onPress,
  disabled,
  busy,
  tone = "gold",
}: {
  label: string;
  /** Shown beside the spinner while `busy`. Use it when the wait has its
   *  own meaning the guest should read — "Opening payment…" is not the
   *  same wait as placing the order. Omit it for a bare spinner. */
  busyLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "gold" | "red";
}): React.ReactElement {
  const textStyle = [styles.primaryBtnText, tone === "red" && { color: colors.onRed }];
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <ActivityIndicator color={tone === "red" ? colors.onRed : colors.ink} />
          {busyLabel ? <Text style={textStyle}>{busyLabel}</Text> : null}
        </View>
      ) : (
        <Text style={textStyle}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * The outlined member of PrimaryButton's family: same pill, same full
 * width, but a hairline border and a red label instead of a filled slab.
 * For an action that is real and must be FINDABLE without competing with
 * the screen's primary one — signing out, which as a text link owners
 * simply never saw.
 */
export function OutlineButton({
  label,
  onPress,
  icon,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  /** Ionicons glyph set before the label, in the label's own colour. */
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  accessibilityLabel?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.outlineBtn, pressed && { opacity: 0.7 }]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.red} /> : null}
      <Text style={styles.outlineBtnText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Diet + allergen badges stacked in the photo's top-right corner, so a
 * guest scanning the list sees "vegan" or "contains milk" without opening
 * the sheet. Diets first, then allergens; anything past
 * `max` collapses into a "+N" badge — the sheet lists everything.
 */
export function DishBadges({
  item,
  max,
  size,
}: {
  item: Pick<ApiItem, "dietary" | "allergens">;
  max: number;
  size: "sm" | "lg";
}): React.ReactElement | null {
  const { t } = useI18n();
  const dietNames = t.dietary as Record<string, string>;
  const allergenNames = t.allergens as Record<string, string>;
  // Halal is the one badge that is ART rather than a glyph: the venue's
  // own حلال mark in its shop-window green, in place of the 🕌 mosque
  // emoji — which said "Islam", not "halal kitchen", and drew a
  // different picture on every platform (see `halal-mark.tsx`). It keeps
  // the badge stack's drop shadow, which is what holds any of these
  // glyphs together over a bright photo.
  const badges: { key: string; icon: React.ReactNode; diet: boolean }[] = [
    ...item.dietary.map((d) => ({
      key: `d-${d}`,
      icon: d === "halal" ? <HalalMark size="chip" shadow /> : (DIET_ICONS[d] ?? "•"),
      diet: true,
    })),
    ...item.allergens.map((a) => ({ key: `a-${a}`, icon: ALLERGEN_ICONS[a] ?? "•", diet: false })),
  ];
  if (badges.length === 0) return null;
  const shown = badges.slice(0, badges.length > max ? max - 1 : max);
  const rest = badges.length - shown.length;
  const label = [
    ...item.dietary.map((d) => dietNames[d] ?? d),
    item.allergens.length > 0
      ? `${t.dishAllergens}: ${item.allergens.map((a) => allergenNames[a] ?? a).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(". ");
  const dim = size === "lg" ? styles.badgeLg : styles.badgeSm;
  const glyph = size === "lg" ? styles.badgeGlyphLg : styles.badgeGlyphSm;
  return (
    <View
      style={styles.badgeStack}
      accessibilityRole="text"
      accessibilityLabel={label}
      pointerEvents="none"
    >
      {shown.map((b) => (
        <View
          key={b.key}
          style={[styles.badge, dim, b.diet ? styles.badgeDiet : styles.badgeAllergen]}
        >
          {typeof b.icon === "string" ? <Text style={glyph}>{b.icon}</Text> : b.icon}
        </View>
      ))}
      {rest > 0 ? (
        <View style={[styles.badge, dim, styles.badgeMore]}>
          <Text style={[glyph, styles.badgeMoreText]}>+{rest}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The "look at this" ring: a steady gold hairline with a warm ember one
 * fading in and out over it, ~1.6 s a cycle. Worn by the Home screen's
 * Offers card and by the Offers chip in the menu rail, which is why it
 * lives here rather than in either of them.
 *
 * TWO overlaid rings rather than one animated `borderColor`, because
 * `borderColor` cannot be driven by the native driver: a colour loop has to
 * cross the bridge on every frame, for as long as the screen is open, and
 * is the first thing to stutter when the menu is being fetched underneath
 * it. Opacity can go native, so the colour change is faked by cross-fading
 * two borders that never move.
 *
 * The host reserves the 2 pt itself — a transparent border of the same
 * width — so the ring costs no layout, and `inset` is how far back out the
 * ring has to reach to cover it: absolutely-positioned children start at
 * the parent's PADDING box, which is already inside the border the ring is
 * meant to trace. `style` carries the host's own corner geometry, since
 * only the host knows whether it is a 16 pt card or a chip with one corner
 * squared off for its tail.
 */
export function PulsingBorder({
  inset = 0,
  style,
}: {
  inset?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const pulse = usePulse();
  const edges = { top: -inset, bottom: -inset, start: -inset, end: -inset };
  return (
    <>
      <View pointerEvents="none" style={[styles.ring, styles.ringGold, edges, style]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, styles.ringEmber, edges, style, { opacity: pulse }]}
      />
    </>
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
  const add = usePressScale();
  return (
    <Pressable style={styles.dishRow} onPress={() => onOpen?.(item)} accessibilityLabel={item.name}>
      <View style={styles.dishPhotoBox}>
        <Image source={{ uri: item.photoUrl }} style={styles.dishPhoto} resizeMode="cover" />
        <DishBadges item={item} max={3} size="sm" />
      </View>
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
            // The wrapper, not the button, carries the auto margin: a
            // transform cannot push a sibling, so the ⊕ has to be pinned to
            // the end of the row from outside the thing that scales.
            <Animated.View style={[styles.addBtnWrap, add.style]}>
              <Pressable
                onPress={() => onAdd(item)}
                onPressIn={add.onPressIn}
                onPressOut={add.onPressOut}
                hitSlop={10}
                accessibilityLabel={`${t.dishAdd} — ${item.name}`}
                style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.addBtnText}>+</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <Text style={[styles.soldOut, { marginStart: "auto" }]}>{t.soldOut}</Text>
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
  // Both keys, not just the plus: a stepper where one half answers to the
  // finger and the other does not feels broken rather than restrained.
  const less = usePressScale();
  const more = usePressScale();
  return (
    <View style={styles.stepper}>
      <Animated.View style={less.style}>
        <Pressable
          onPress={() => onChange(quantity - 1)}
          onPressIn={less.onPressIn}
          onPressOut={less.onPressOut}
          hitSlop={8}
          style={styles.stepBtn}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
      </Animated.View>
      <Text style={styles.stepQty}>{quantity}</Text>
      <Animated.View style={more.style}>
        <Pressable
          onPress={() => onChange(quantity + 1)}
          onPressIn={more.onPressIn}
          onPressOut={more.onPressOut}
          hitSlop={8}
          style={styles.stepBtn}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * The one height every screen's red bar agrees on, safe-area padding
 * excluded. It is the tallest case there is, added up rather than
 * guessed at: the venue lockup stretched to its 225 pt cap is a 71 pt
 * box (the mark is 4.66 : 1, plus the rim the white stroke needs above
 * and below — see `venue-wordmark.tsx`), then the rating's own row (2 pt
 * of air + a 24 pt press box) — 97, rounded up to 98.
 *
 * The town used to have a line of its own in here. It is gone at the
 * owner's word (2026-09-22), and the space went into the mark: the
 * lockup already says the restaurant's name and what it is, and
 * "Konstanz" underneath was a third thing to read in a bar that is
 * chrome, not content. It still heads the Account screen, where there is
 * room for the whole letterhead.
 *
 * It was 66 while the name was Nunito 800 at 17; the lockup carries a
 * second line, an arch and strokes that sit outside the glyphs, and this
 * is that difference, measured rather than eyeballed. Nothing here is
 * free: every point here is a point off every screen below it. The mark
 * went to 34 at the owner's word (2026-09-22) — the bar had space around
 * the name, and the points badge (half its height, 30 pt of its slot)
 * and the round logo (all 44 pt of its rail) gave that space up for it.
 * The mark is 4.66 times as wide as it is tall, so every point of width
 * it gains is a fifth of a point of bar height: this is as big as the
 * name gets before the red slab starts eating the screen.
 *
 * A screen with no rating renders the SAME 98 and
 * simply centres what it has in it. That is the point: the red slab must
 * not change height when the guest moves between Home, Menu, Cart and
 * Orders.
 */
const HEADER_CONTENT_HEIGHT = 98;
/** Both side slots, reserved whether or not anything is in them, so the
 *  centred title always has the same gutter left and right. 44 is the
 *  minimum touch target, which the burger now fills exactly. */
const HEADER_SLOT = 44;
/** The venue mascot with its white card removed — see
 *  `scripts/cut-out-logo.mjs`. */
const LOGO_CUTOUT = require("../assets/logo-cutout.png");

/** The POINTS badge: a square, and a small one. It was a 65 × 42 card,
 *  then briefly a wide one-row pill; both read as a second title
 *  competing with the venue's name. 40 keeps it inside the 44 pt rail the
 *  burger already reserves, and `hitSlop` carries the touch target. */
const POINTS_BADGE = 42;
/** How far below the bar's middle the badge sits. */
const POINTS_BADGE_DROP = 10;
/** What the name is fitted to before the first layout: the narrowest
 *  middle slot there is (a 360 pt phone, less the 16 pt insets, the two
 *  44 pt slots and the two 8 pt gaps). Never wider than the real one, so
 *  the lettering only ever grows into place, never jumps back. */
const HEADER_TITLE_MIN = 224;
/**
 * …and the widest it may get. The lockup is 4.66 times as wide as it is
 * tall, so its width IS the bar's height: uncapped, a 430 pt phone would
 * give the mark 294 pt and a 73 pt box while a 360 pt one gave it 58,
 * and `HEADER_CONTENT_HEIGHT` is a single number for every device. 260
 * is the widest that still fits that number.
 */
const HEADER_TITLE_MAX = 225;

const styles = StyleSheet.create({
  /** The asterisk on a required field, and the line that explains it.
   *  Brand red on cream clears AA at this size, and the glyph itself —
   *  not the colour — is what carries the meaning. */
  requiredMark: { color: colors.red, ...fonts.bodyHeavy },
  /** The two halves of `PulsingBorder`. Same box, same corners; only the
   *  colour and the glow differ, so the cross-fade never shifts an edge. */
  ring: { position: "absolute", borderWidth: 2 },
  ringGold: { borderColor: colors.goldSoft },
  ringEmber: {
    borderColor: colors.ember,
    /** The glow rides the ring's OWN opacity — one native-driven fade moves
     *  the border colour and the halo together, where an animated
     *  `shadowOpacity` would have to run on the JS thread. Android is left
     *  out on purpose: its elevation shadow takes no colour, so an orange
     *  halo is not a thing it can draw, and the hosts carry a steady
     *  `elevation` for lift instead. */
    ...Platform.select({
      ios: {
        shadowColor: colors.ember,
        shadowOpacity: 0.55,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 0 },
      },
      default: {},
    }),
  },
  requiredLegend: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  /** The red slab. It owns the padding and the colour so the rows
   *  inside it are pure layout — and so the status line, when it is
   *  there, sits inside the same red rather than under it. */
  headerWrap: {
    backgroundColor: colors.red,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  /** Fixed height, and `stretch` so the side slots are full-height rails
   *  that can park their contents at the top (burger) or the middle
   *  (logo / back arrow) independently.
   *
   *  `gap: 8` rather than the old 12: the title is now the name's FIRST
   *  line ("Rangla Punjab Restaurant"), which at 20 pt needs ~240 pt, and
   *  375 - 32 padding - 2×44 slots - 2×8 gaps leaves it 239.
   *  `adjustsFontSizeToFit` on the title is the guarantee for the names
   *  that don't fit even that. */
  header: {
    flexDirection: "row",
    alignItems: "stretch",
    height: HEADER_CONTENT_HEIGHT,
    gap: 8,
  },
  /** The back arrow keeps its old vertical centring. */
  headerStart: { width: HEADER_SLOT, justifyContent: "center", alignItems: "flex-start" },
  /** The mascot, cut out of its white card and given the rail's full
   *  width. No circle, no fill: on the red bar it is the figure itself. */
  headerLogo: { width: 42, height: 42 },
  /** The burger rides the TOP of the content area (owner's ask), flush
   *  with the slab's own 16 pt inset on the end side. */
  headerEnd: { width: HEADER_SLOT, justifyContent: "flex-start", alignItems: "flex-end" },
  /** The POINTS badge sits a little BELOW the mascot's top rather than
   *  level with it (owner, 2026-09-22): the mascot's art runs to the
   *  edges of its box and the badge is a solid white card, so matching
   *  their boxes made the card look like it was riding high. Stated as
   *  the centred position plus a drop, so it survives a change to the
   *  bar's height. The burger keeps the top — it is a menu affordance,
   *  not part of the venue's row. */
  headerEndCentred: {
    justifyContent: "flex-start",
    paddingTop: (HEADER_CONTENT_HEIGHT - POINTS_BADGE) / 2 + POINTS_BADGE_DROP,
  },
  /** White card on the red, as in the owner's mock. */
  /**
   * The badge itself: a warm card with a gold edge, not a plain white
   * chip.
   *
   * Every surface this app lifts off a background is the same three
   * things — the cream card colour, a gold hairline and a soft drop
   * shadow (the dish cards, the reward banner, the gift-card tiles used
   * to be). The badge was the one exception, a flat white square, and on
   * the red bar it read as a system control rather than as something of
   * the restaurant's. Now it matches, at a quarter of the size: the
   * cream keeps it warm against the red, the gold ring is what makes it
   * look made rather than drawn, and the shadow lifts it off the slab.
   */
  headerPoints: {
    width: POINTS_BADGE,
    height: POINTS_BADGE,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.creamCard,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  /** The gift over the word, in a SQUARE (owner, 2026-09-22: a badge as
   *  wide as a sentence read as a button for something else). */
  headerPointsBody: { alignItems: "center", gap: 1 },
  /** Same 40pt footprint as the logo, so swapping either slot in or out
   *  never shifts the title off centre. */
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  /** A full 44 pt target, since nothing above it constrains the corner. */
  headerMenuBtn: {
    width: HEADER_SLOT,
    height: HEADER_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  /** `flexDirection: "row"` mirrors itself in an RTL build, so the dot
   *  stays on the reading edge with nothing to special-case.
   *
   *  The hairline outline is for the hero: an ink-tinted edge at 14%
   *  separates the pale fill from pale artwork, and the soft drop
   *  shadow does the same job on Android, where a hairline can vanish
   *  at low density. Neither touches the text's contrast, which is
   *  measured against the fill. */
  statePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexShrink: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(28, 20, 16, 0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  stateDot: { width: 9, height: 9, borderRadius: 5 },
  stateText: { ...fonts.bodyHeavy, fontSize: 11, letterSpacing: 0.2 },
  /**
   * Line 1, on the screens that do NOT wear the sticker lettering — a
   * screen's own name ("Cart", "Orders"). 17 pt of Nunito 800: the
   * centre slot on a 360 pt phone is 224 pt (360 - 32 padding - 2×44
   * side rails - 2×8 gaps), and this name measures ~212 there, which
   * leaves the margin `adjustsFontSizeToFit` then guarantees for the
   * longer ones. `lineHeight` is stated so the fixed bar height stays
   * arithmetic rather than a guess about each platform's ascenders.
   */
  headerTitle: {
    color: colors.onRed,
    fontSize: 17,
    lineHeight: 22,
    textAlign: "center",
    ...fonts.display,
  },
  /** One baseline under the name. `minHeight` + `paddingVertical` give
   *  the press a ~28 pt box of its own, and the 10 pt hitSlop above and
   *  below takes the real target past 44 pt without pushing the header
   *  taller than the subtitle it replaces by more than a few points.
   *  It must NOT wrap: the bar's height is fixed, so a second line would
   *  be clipped rather than accommodated — the link shrinks and
   *  ellipsises instead (`numberOfLines={1}` on it). */
  headerRating: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "nowrap",
    gap: 4,
    marginTop: 2,
    minHeight: 24,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  headerRatingStar: { color: colors.goldSoft, ...fonts.body, fontSize: 13 },
  headerRatingValue: { color: colors.onRed, ...fonts.bodyBold, fontSize: 12.5 },
  headerRatingCount: { color: colors.goldSoft, ...fonts.body, fontSize: 12 },
  headerRatingLink: {
    color: colors.onRed,
    ...fonts.bodySemi,
    fontSize: 12,
    textDecorationLine: "underline",
    flexShrink: 1,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: { color: colors.ink, fontSize: 18, ...fonts.bodyBold },
  sectionAction: { color: colors.red, fontSize: 13, ...fonts.bodySemi },
  primaryBtn: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.ink, ...fonts.bodyBold, letterSpacing: 0.5 },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    // 44 is the minimum comfortable tap target, and the reason this
    // control exists at all — the 13px link it replaces was ~16.
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
  outlineBtnText: { color: colors.red, ...fonts.bodyBold, fontSize: 14, letterSpacing: 0.3 },
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
  dishPhotoBox: { width: 84, height: 84 },
  dishPhoto: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    backgroundColor: colors.line,
  },
  // Badge column pinned to the photo's top-right (end-aligned so RTL
  // mirrors it). Plain glyphs, no chip behind them — a soft drop shadow
  // keeps them legible on a bright photo.
  badgeStack: { position: "absolute", top: 3, end: 3, gap: 1, alignItems: "flex-end" },
  badge: { alignItems: "center", justifyContent: "center" },
  badgeSm: { width: 22, height: 22 },
  badgeLg: { width: 34, height: 34 },
  badgeGlyphSm: {
    fontSize: 15,
    lineHeight: 19,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
  badgeGlyphLg: {
    fontSize: 24,
    lineHeight: 30,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  badgeDiet: {},
  badgeAllergen: {},
  badgeMore: {},
  badgeMoreText: {
    color: "#ffffff",
    ...fonts.bodyHeavy,
    fontSize: 12,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
  dishName: { color: colors.ink, fontSize: 15.5, lineHeight: 20, ...fonts.bodyBold },
  dishDesc: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 18 },
  dishPrice: { color: colors.red, fontSize: 14, ...fonts.bodyBold },
  dishBasePrice: {
    color: colors.inkSoft,
    ...fonts.body,
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
    ...fonts.bodyHeavy,
    letterSpacing: 0.5,
  },
  // Mockup's add control: a soft-cornered SQUARE pinned to the card's
  // bottom-right, sitting on the price row.
  // Smaller tile, bigger glyph: the button reads as a compact control
  // while the "+" stays the thing the thumb aims at. hitSlop on the
  // Pressable keeps the tap target comfortable despite the smaller box.
  addBtnWrap: { marginStart: "auto" },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: colors.onRed, fontSize: 22, ...fonts.bodySemi, lineHeight: 25 },
  soldOut: { color: colors.inkSoft, ...fonts.body, fontSize: 11, fontStyle: "italic" },
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
  stepBtnText: { color: colors.red, fontSize: 16, ...fonts.bodyBold, lineHeight: 18 },
  stepQty: {
    color: colors.ink,
    fontSize: 15,
    ...fonts.bodyBold,
    minWidth: 18,
    textAlign: "center",
  },
});
