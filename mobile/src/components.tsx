import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, isRTL, logo, money, radius, statusTones } from "./theme";
import { ALLERGEN_ICONS, DIET_ICONS, useI18n } from "./i18n";
import type { ApiItem } from "./api";

/**
 * Red screen header with the brand mark — the mockup's top bar.
 *
 * The two optional slots belong to RESTAURANT MODE: a burger at the end
 * that opens the owner's menu, and a back arrow in place of the logo on
 * the screens that aren't tabs. A guest build passes neither, so the bar
 * is exactly the mockup's.
 *
 * `openNow` adds the venue's open/closed pill on its OWN line, tucked
 * under the burger at the end edge. It used to share the first row, and
 * on a phone that row could not hold logo + burger + pill + a real venue
 * name: "Rangla Punjab · Konstanz" was left fighting the pill for what
 * was left. The name now gets the whole first row back, and the pill
 * gets a line of its own where nothing can squeeze it.
 *
 * It is a THREE-state prop on purpose: `undefined`/`null` means nobody
 * has told us, and the header then shows nothing — not even the second
 * line — rather than guessing: a wrong "Closed" over the restaurant's
 * own name costs it orders.
 */
export function BrandHeader({
  title,
  subtitle,
  onMenu,
  onBack,
  openNow,
}: {
  title: string;
  subtitle?: string;
  onMenu?: () => void;
  onBack?: () => void;
  openNow?: boolean | null;
}): React.ReactElement {
  const { t } = useI18n();
  const showState = openNow !== null && openNow !== undefined;
  return (
    <View style={styles.headerWrap}>
      <View style={styles.header}>
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
          <Image source={logo} style={styles.headerLogo} />
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        {onMenu ? (
          <Pressable
            onPress={onMenu}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t.ownerMenuOpen}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="menu" size={26} color={colors.onRed} />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>
      {/* Second line: the pill alone, hugging the end edge so it lands
          directly beneath the burger (and beneath the back arrow's
          mirror image in an RTL build — `flex-end` follows the writing
          direction, so there is nothing to special-case). */}
      {showState ? (
        <View style={styles.headerStateRow}>
          <VenueStatePill open={openNow} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Open or closed, said in three ways at once: a coloured dot, a filled
 * pill, and the WORD. The word is what makes it work for someone who
 * cannot tell the dots apart — colour is never carrying the meaning on
 * its own here.
 *
 * The pill has its own light fill rather than sitting bare on the red
 * header: green-on-brand-red would not clear AA, and this is the one
 * line on the screen a guest may act on.
 */
function VenueStatePill({ open }: { open: boolean }): React.ReactElement {
  const { t } = useI18n();
  const tone = open ? statusTones.open : statusTones.closed;
  const label = open ? t.venueOpen : t.venueClosed;
  return (
    <View
      style={[styles.statePill, { backgroundColor: tone.fill }]}
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
  const badges = [
    ...item.dietary.map((d) => ({ key: `d-${d}`, icon: DIET_ICONS[d] ?? "•", diet: true })),
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
          <Text style={glyph}>{b.icon}</Text>
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
            <Pressable
              onPress={() => onAdd(item)}
              hitSlop={10}
              accessibilityLabel={`${t.dishAdd} — ${item.name}`}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.addBtnText}>+</Text>
            </Pressable>
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
  /** The red slab. It owns the padding and the colour so the rows
   *  inside it are pure layout — and so the status line, when it is
   *  there, sits inside the same red rather than under it. */
  headerWrap: {
    backgroundColor: colors.red,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  /** `gap: 8` rather than the old 12: "Rangla Punjab · Konstanz" at 20 pt
   *  needs 235 pt and a 375 pt phone left it 237 — two points from
   *  wrapping. Eight points either side of a 40 pt icon still reads as
   *  space, and buys the longest venue name room it can be trusted with. */
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  /** The pill's own line. `flex-end` puts it on the END edge — under the
   *  burger in LTR, under the mirrored one in RTL — and the row is only
   *  rendered at all when there is a pill to put in it, so a header
   *  without one keeps exactly its old height. */
  headerStateRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  headerLogo: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cream },
  /** Same 40pt footprint as the logo, so swapping either slot in or out
   *  never shifts the title off centre. */
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  /** `flexDirection: "row"` mirrors itself in an RTL build, so the dot
   *  stays on the reading edge with nothing to special-case. */
  statePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexShrink: 1,
  },
  stateDot: { width: 9, height: 9, borderRadius: 5 },
  stateText: { ...fonts.bodyHeavy, fontSize: 11, letterSpacing: 0.2 },
  headerTitle: { color: colors.onRed, fontSize: 20, ...fonts.display },
  headerSubtitle: {
    color: colors.goldSoft,
    ...fonts.body,
    fontSize: 11,
    letterSpacing: 3,
    marginTop: 1,
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
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    marginStart: "auto",
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
