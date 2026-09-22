import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ApiLoyaltyEntry, ApiMenu } from "../api";
import { useAuth } from "../auth";
import { BrandHeader } from "../components";
import { fill, localeTag, useI18n } from "../i18n";
import { orderNo, RewardSheet, shortDate, useLoyalty } from "../loyalty";
import { colors, fonts, money, radius } from "../theme";
import { useLayout } from "../layout";

const MASCOT = require("../../assets/mascot-thumbs-up.png");

/** "€20" rather than "€20,00" when there are no cents — the posters'
 *  own spelling; a real "€12,50" keeps its decimals. */
function price(cents: number, currency: string): string {
  if (cents % 100 !== 0) return money(cents, currency);
  const whole = String(cents / 100);
  return currency === "EUR" ? `€${whole}` : `${whole} ${currency}`;
}

/** A gold coin with a star, drawn rather than an emoji (the platform
 *  coin emoji is silver on iOS). */
function Coin({ size, style }: { size: number; style?: object }): React.ReactElement {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: "#F4B400",
          borderWidth: Math.max(1.5, size * 0.09),
          borderColor: "#E09100",
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Ionicons name="star" size={size * 0.52} color="#FFE27A" />
    </View>
  );
}

/** The owner's mock (2026-09-22), in its own colours: a clear green for
 *  progress and the promo card, the brand red for everything else. */
const GREEN = "#1F8A3B";
const GREEN_DARK = "#1B6B2A";
const GREEN_SOFT = "#EEF7E1";
const GREEN_LINE = "#D5EBC0";
const CARD = "#FFFFFF";

/**
 * "My Points" — the page behind the header's POINTS badge.
 *
 * Top to bottom, as in the owner's mock: the balance and how far the next
 * reward is; the "Order More, Get Rewarded!" card with the mascot; Redeem
 * (the existing reward sheet) and Points History side by side; How It
 * Works in three steps; and the small print — food only, NO CASH VALUE.
 *
 * Every number comes from the venue's own loyalty settings (the menu
 * payload, then the guest's account once it lands), never from the mock:
 * an owner who changes "5 per €20" or "100 for €20" changes this page.
 * Signed out, the balance card becomes a sign-in prompt; the rules, the
 * steps and the small print still show — they are the reason to sign in.
 */
export function PointsScreen({
  menu,
  onBack,
  onOpenAccount,
}: {
  menu: ApiMenu;
  onBack: () => void;
  /** Sign-in lives on the Account tab. */
  onOpenAccount: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { token } = useAuth();
  const layout = useLayout();
  const { loyalty, reload } = useLoyalty(menu.loyalty?.enabled);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const tag = localeTag(lang);
  const currency = menu.venue.currency;

  const config = {
    enabled: menu.loyalty?.enabled ?? false,
    minOrderCents: loyalty?.minOrderCents ?? menu.loyalty?.minOrderCents ?? 2000,
    pointsPerOrder: loyalty?.pointsPerOrder ?? menu.loyalty?.pointsPerOrder ?? 5,
    rewardPoints: loyalty?.rewardPoints || menu.loyalty?.rewardPoints || 100,
    rewardValueCents: loyalty?.rewardValueCents || menu.loyalty?.rewardValueCents || 2000,
  };
  const balance = loyalty?.balance ?? 0;
  const missing = Math.max(0, config.rewardPoints - balance);
  const ratio = Math.min(1, balance / Math.max(1, config.rewardPoints));
  const reward = price(config.rewardValueCents, currency);
  const min = price(config.minOrderCents, currency);
  const rewardReady = (loyalty?.vouchers ?? []).some(
    (v) => v.status === "available" || v.status === "armed",
  );

  const entryValue = (e: ApiLoyaltyEntry): string =>
    price(e.valueCents ?? config.rewardValueCents, currency);
  const historyLabel = (e: ApiLoyaltyEntry): string => {
    if (e.reason === "reversal") return t.rewardsCancelled;
    if (e.reason === "voucher") return `${t.rewardsReward} · ${entryValue(e)}`;
    if (e.reason === "redeem") {
      const spent = fill(t.rewardsRedeemed, { value: entryValue(e) });
      return e.orderNumber === null
        ? spent
        : `${spent} · ${t.rewardsOrder} #${orderNo(e.orderNumber)}`;
    }
    if (e.reason === "order") {
      return e.orderNumber === null
        ? t.rewardsOrder
        : `${t.rewardsOrder} #${orderNo(e.orderNumber)}`;
    }
    return t.rewardsAdjust;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.pointsScreenTitle} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: layout.pad, paddingBottom: 40, gap: 14 }}>
        {/* 1 · The balance, and the distance to the next reward. */}
        {token ? (
          <View style={styles.card}>
            <View style={styles.balanceRow}>
              <View style={styles.balanceHalf}>
                <Text style={styles.yourPoints}>{t.pointsYour}</Text>
                <Text
                  style={styles.bigNumber}
                  accessibilityLabel={fill(t.pointsBadgeLabel, { points: balance })}
                >
                  {balance}
                </Text>
                <Text style={styles.pointsWord}>{t.pointsUnit}</Text>
              </View>
              <View style={styles.vDivider} />
              <View style={[styles.balanceHalf, styles.rewardHalf]}>
                <Text
                  style={styles.giftEmoji}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  🎁
                </Text>
                <View style={{ flex: 1, alignItems: "center" }}>
                  {rewardReady || missing === 0 ? (
                    <Text style={styles.readyText}>{t.pointsRewardReady}</Text>
                  ) : (
                    <Text style={styles.moreFor}>{fill(t.pointsMoreFor, { points: missing })}</Text>
                  )}
                  <Text style={styles.rewardValue} adjustsFontSizeToFit numberOfLines={1}>
                    {reward}
                  </Text>
                  <Text style={styles.foodReward}>{t.pointsFoodReward}</Text>
                </View>
              </View>
            </View>
            <View
              style={styles.track}
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: config.rewardPoints,
                now: Math.min(balance, config.rewardPoints),
              }}
            >
              <View style={[styles.trackFill, { width: `${Math.round(ratio * 100)}%` }]} />
            </View>
            <View style={styles.trackLabels}>
              {/* Just what has been collected — no "/ 100": the target is
                  whatever the owner sets, and the bar already shows it. */}
              <Text style={styles.trackLabel}>
                {balance} {t.pointsUnit}
              </Text>
              <Text style={styles.trackLabel}>{fill(t.pointsRewardLabel, { value: reward })}</Text>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={onOpenAccount}
            accessibilityRole="button"
            style={({ pressed }) => [styles.card, styles.signInCard, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.giftEmoji}>🎁</Text>
            <Text style={styles.signInText}>{t.pointsSignIn}</Text>
            <Ionicons name="chevron-forward" size={22} color={colors.red} />
          </Pressable>
        )}

        {/* 2 · The rule, said the way the posters say it. */}
        <View style={styles.promo}>
          <Image
            source={MASCOT}
            style={styles.mascot}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.promoTitle}>{t.pointsPromoTitle}</Text>
            <Text style={styles.promoLine}>
              {fill(t.pointsPromoRule, { min, points: config.pointsPerOrder })}
            </Text>
            <Text style={styles.promoLine}>{t.pointsPromoMore}</Text>
            <Text style={styles.promoLine}>{fill(t.pointsPromoMin, { min })}</Text>
          </View>
          <View
            style={styles.coins}
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
          >
            <Coin size={26} style={{ transform: [{ rotate: "-15deg" }] }} />
            <Coin size={22} style={{ marginTop: 6, transform: [{ rotate: "12deg" }] }} />
          </View>
        </View>

        {/* 3 · The two actions. */}
        {token ? (
          <View style={styles.actions}>
            <Pressable
              onPress={() => setSheetOpen(true)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.action,
                styles.actionRed,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="gift-outline" size={26} color={colors.onRed} />
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitleOnRed} numberOfLines={1} adjustsFontSizeToFit>
                  {t.pointsRedeem}
                </Text>
                <Text style={styles.actionSubOnRed} numberOfLines={2}>
                  {fill(t.pointsRedeemSub, { points: config.rewardPoints, value: reward })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onRed} />
            </Pressable>
            <Pressable
              onPress={() => setHistoryOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityState={{ expanded: historyOpen }}
              style={({ pressed }) => [
                styles.action,
                styles.actionWhite,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="time-outline" size={26} color={colors.red} />
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle} numberOfLines={1} adjustsFontSizeToFit>
                  {t.rewardsHistory}
                </Text>
                <Text style={styles.actionSub} numberOfLines={2}>
                  {t.pointsHistorySub}
                </Text>
              </View>
              <Ionicons
                name={historyOpen ? "chevron-down" : "chevron-forward"}
                size={20}
                color={colors.ink}
              />
            </Pressable>
          </View>
        ) : null}

        {token && historyOpen ? (
          <View style={styles.card}>
            {(loyalty?.history ?? []).length === 0 ? (
              <Text style={styles.muted}>{t.rewardsHistoryEmpty}</Text>
            ) : (
              (loyalty?.history ?? []).map((entry) => {
                const when = shortDate(entry.createdAt, tag);
                return (
                  <View key={entry.id} style={styles.historyRow}>
                    <Text
                      style={[styles.historyDelta, entry.delta < 0 && { color: colors.inkSoft }]}
                    >
                      {entry.reason === "redeem"
                        ? "🎁"
                        : `${entry.delta < 0 ? "−" : "+"}${Math.abs(entry.delta)}`}
                    </Text>
                    <Text style={styles.historyLabel} numberOfLines={1}>
                      {historyLabel(entry)}
                    </Text>
                    {when ? <Text style={styles.historyDate}>{when}</Text> : null}
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {/* 4 · How it works, in three steps. */}
        <View style={styles.hr} />
        <Text style={styles.howTitle}>{t.pointsHowTitle}</Text>
        <View style={styles.howRow}>
          <View style={styles.howCell}>
            <Ionicons name="cart-outline" size={40} color={colors.red} />
            <Text style={styles.howStrong}>{fill(t.pointsHowSpendA, { min })}</Text>
            <Text style={styles.howText}>{t.pointsHowSpendB}</Text>
          </View>
          <View style={styles.howDivider} />
          <View style={styles.howCell}>
            <Ionicons name="layers-outline" size={40} color={colors.red} />
            <Text style={styles.howText}>{t.pointsHowGetA}</Text>
            <Text style={styles.howStrong}>
              {fill(t.pointsHowGetB, { points: config.pointsPerOrder })}
            </Text>
          </View>
          <View style={styles.howDivider} />
          <View style={styles.howCell}>
            <Ionicons name="gift-outline" size={40} color={colors.red} />
            <Text style={styles.howStrong}>
              {fill(t.pointsHowCollectA, { points: config.rewardPoints })}
            </Text>
            <Text style={styles.howText}>{fill(t.pointsHowCollectB, { value: reward })}</Text>
          </View>
        </View>

        {/* 5 · The small print — including that points have no cash value. */}
        <View style={styles.note}>
          <Ionicons name="information-circle" size={30} color={colors.inkSoft} />
          <Text style={styles.noteText}>{t.pointsNote}</Text>
        </View>
      </ScrollView>

      <RewardSheet
        visible={sheetOpen}
        loyalty={loyalty}
        config={config}
        currency={currency}
        onClose={() => setSheetOpen(false)}
        onChanged={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  balanceRow: { flexDirection: "row", alignItems: "stretch" },
  balanceHalf: { flex: 1, alignItems: "center", justifyContent: "center" },
  rewardHalf: { flexDirection: "row", gap: 6 },
  vDivider: { width: 1, backgroundColor: colors.line, marginHorizontal: 10 },
  yourPoints: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 18 },
  bigNumber: { color: colors.red, ...fonts.bodyHeavy, fontSize: 54, lineHeight: 58 },
  pointsWord: { color: colors.ink, ...fonts.bodySemi, fontSize: 16 },
  giftEmoji: { fontSize: 42 },
  moreFor: { color: colors.ink, ...fonts.bodySemi, fontSize: 12.5, textAlign: "center" },
  readyText: { color: GREEN_DARK, ...fonts.bodyHeavy, fontSize: 13, textAlign: "center" },
  rewardValue: { color: colors.red, ...fonts.bodyHeavy, fontSize: 36, lineHeight: 42 },
  foodReward: { color: colors.ink, ...fonts.bodySemi, fontSize: 13.5, textAlign: "center" },
  track: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#E2E2E2",
    overflow: "hidden",
    marginTop: 16,
  },
  trackFill: { height: "100%", borderRadius: 6, backgroundColor: GREEN },
  trackLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  trackLabel: { color: colors.ink, ...fonts.bodySemi, fontSize: 13.5 },
  signInCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  signInText: { flex: 1, color: colors.ink, ...fonts.bodyHeavy, fontSize: 16 },
  promo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: GREEN_SOFT,
    borderWidth: 1,
    borderColor: GREEN_LINE,
    borderRadius: radius.lg,
    padding: 12,
    overflow: "hidden",
  },
  mascot: { width: 78, height: 105 },
  promoTitle: { color: GREEN_DARK, ...fonts.bodyHeavy, fontSize: 16 },
  promoLine: { color: colors.ink, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  coins: { position: "absolute", end: 8, bottom: 6, flexDirection: "row", gap: 2, opacity: 0.95 },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 8,
    minHeight: 76,
  },
  actionRed: { backgroundColor: colors.red },
  actionWhite: { backgroundColor: CARD, borderWidth: 1, borderColor: colors.line },
  actionTitleOnRed: { color: colors.onRed, ...fonts.bodyHeavy, fontSize: 14.5 },
  actionSubOnRed: { color: colors.onRed, ...fonts.body, fontSize: 11.5, opacity: 0.95 },
  actionTitle: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 14.5 },
  actionSub: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  historyDelta: { color: GREEN, ...fonts.bodyHeavy, fontSize: 14, minWidth: 40 },
  historyLabel: { color: colors.ink, ...fonts.body, fontSize: 13, flex: 1 },
  historyDate: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
  muted: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  hr: { height: 1, backgroundColor: colors.line, marginTop: 4 },
  howTitle: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 19 },
  howRow: { flexDirection: "row", alignItems: "stretch" },
  howCell: { flex: 1, alignItems: "center", gap: 4, paddingHorizontal: 4 },
  howDivider: { width: 1, backgroundColor: colors.line },
  howStrong: { color: colors.red, ...fonts.bodyHeavy, fontSize: 14.5, textAlign: "center" },
  howText: { color: colors.ink, ...fonts.bodySemi, fontSize: 13, textAlign: "center" },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
  },
  noteText: { flex: 1, color: colors.inkSoft, ...fonts.body, fontSize: 12, lineHeight: 17 },
});
