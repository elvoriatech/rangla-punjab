import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiLoyalty, ApiLoyaltyConfig, ApiVoucher } from "./api";
import { fetchLoyalty, setVoucherArmed } from "./api";
import { useAuth } from "./auth";
import { fill, localeTag, useI18n } from "./i18n";
import { colors, fonts, money, radius } from "./theme";
import { PrimaryButton } from "./components";

/**
 * Loyalty — points a guest collects on qualifying orders, and the
 * vouchers those points buy.
 *
 * Everything here is additive and silent: the hook answers `null` when
 * the guest is signed out, the venue has the programme off, or the
 * server predates it, and every screen simply renders nothing. No
 * loading spinner and no error state leak into the main surfaces —
 * points are a bonus, never something an order waits for.
 *
 * "Armed" is only the guest saying "use this on my next order". The
 * discount itself is applied server-side when that order is placed.
 */

/** A voucher the guest can still do something with. */
export function isOfferable(v: ApiVoucher): boolean {
  return v.status === "available" || v.status === "armed";
}

/** A voucher that has been spent. Worth showing for a while: "where did
 *  my reward go" is the first question after it disappears. */
export function isRedeemed(v: ApiVoucher): boolean {
  return v.status === "redeemed";
}

/** The armed voucher, i.e. the one the next order will actually spend.
 *  Null whenever there is nothing to redeem — which is every case the
 *  cart must leave alone. */
export function armedVoucher(loyalty: ApiLoyalty | null): ApiVoucher | null {
  return loyalty?.vouchers.find((v) => v.status === "armed") ?? null;
}

/**
 * What a reward actually takes off a given total — never more than the
 * bill itself. The server recomputes this and its answer wins; this is
 * only so the guest sees the right number before tapping.
 */
export function discountFor(voucher: ApiVoucher | null, totalCents: number): number {
  if (!voucher || totalCents <= 0) return 0;
  return Math.min(Math.max(0, voucher.valueCents), totalCents);
}

/** "0031" — an order number padded the way every other one in the app is
 *  (the "#" belongs to the surrounding copy, which differs per language). */
export function orderNo(orderNumber: number): string {
  return String(orderNumber).padStart(4, "0");
}

/** The one voucher a surface should talk about: the armed one if there
 *  is one (it's the live promise), else the first one still available. */
export function headlineVoucher(loyalty: ApiLoyalty | null): ApiVoucher | null {
  if (!loyalty) return null;
  return (
    loyalty.vouchers.find((v) => v.status === "armed") ??
    loyalty.vouchers.find((v) => v.status === "available") ??
    null
  );
}

/** "30 Sep" / "30. Sept." — day + month in the guest's language. An
 *  unparseable timestamp yields "", and the caller drops the line. */
export function shortDate(iso: string, tag: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(tag, { day: "numeric", month: "short" });
}

/**
 * This customer's loyalty state, refetched whenever the screen using it
 * mounts (the tab shell rebuilds each screen on switch, so that is also
 * "on focus") and on demand after arming a voucher.
 *
 * `enabled` is the venue's own switch — pass `menu.loyalty?.enabled`, so
 * a venue without the programme never makes the request at all.
 */
export function useLoyalty(enabled: boolean | undefined): {
  loyalty: ApiLoyalty | null;
  reload: () => void;
} {
  const { token } = useAuth();
  const [loyalty, setLoyalty] = useState<ApiLoyalty | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !token) {
      setLoyalty(null);
      return;
    }
    let alive = true;
    void fetchLoyalty(token).then((next) => {
      if (!alive) return;
      // The venue's switch wins over a stale account payload.
      setLoyalty(next && next.enabled ? next : null);
    });
    return () => {
      alive = false;
    };
  }, [enabled, token, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { loyalty, reload };
}

/** Gold progress track — points collected against the points a reward
 *  costs. Purely decorative; the "60 / 100" beside it carries the value. */
export function PointsBar({ have, need }: { have: number; need: number }): React.ReactElement {
  const ratio = need > 0 ? Math.min(1, Math.max(0, have / need)) : 0;
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: Math.max(need, 1), now: Math.min(have, need) }}
    >
      <View style={[styles.trackFill, { width: `${Math.round(ratio * 100)}%` }]} />
    </View>
  );
}

/**
 * "Check my reward" — the popup behind the Rewards card's button, in the
 * same bottom-sheet language as the dish and reservation sheets.
 *
 * Three states, decided by what the server says the guest holds: still
 * collecting, a reward earned and waiting, or a reward already switched
 * on for the next order. The expiry date shows in all three of the
 * latter two, because a reward the guest can't see the end of is a
 * reward they will lose.
 */
export function RewardSheet({
  visible,
  loyalty,
  config,
  currency,
  onClose,
  onChanged,
}: {
  visible: boolean;
  loyalty: ApiLoyalty | null;
  /** The menu's own copy of the thresholds, so the "not yet" state reads
   *  correctly in the moment before the account payload lands. */
  config: ApiLoyaltyConfig;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const tag = localeTag(lang);

  useEffect(() => {
    if (visible) setError(false);
  }, [visible]);

  const voucher = headlineVoucher(loyalty);
  const armed = voucher?.status === "armed";
  const rewardPoints = loyalty?.rewardPoints || config.rewardPoints;
  const value = money(
    voucher?.valueCents ?? (loyalty?.rewardValueCents || config.rewardValueCents),
    currency,
  );
  const meal = fill(t.rewardsMeal, { value });
  const expiry = voucher ? shortDate(voucher.expiresAt, tag) : "";
  const missing = Math.max(0, rewardPoints - (loyalty?.balance ?? 0));
  // Nothing to offer, but a reward WAS just spent: say where it went,
  // otherwise the card looks like the reward evaporated.
  const justUsed = voucher
    ? null
    : (loyalty?.vouchers.find((v) => isRedeemed(v) && v.redeemedOrderNumber !== null) ?? null);

  async function toggle(next: boolean): Promise<void> {
    if (!voucher || busy) return;
    setBusy(true);
    setError(false);
    const result = await setVoucherArmed(token, voucher.id, next);
    setBusy(false);
    if (!result.ok) {
      setError(true);
      return;
    }
    onChanged();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t.close}>
        {/* The panel swallows taps so only the dimmed area dismisses. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24, gap: 14 }}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetKicker}>{t.rewardsTitle}</Text>

            {voucher ? (
              <>
                <Text style={styles.sheetTitle}>
                  {fill(armed ? t.rewardsArmedTitle : t.rewardsEarnedTitle, { value })}
                </Text>
                <View style={styles.voucher}>
                  <Text style={styles.voucherValue}>{meal}</Text>
                  {expiry ? (
                    <Text style={styles.voucherMeta}>
                      {fill(t.rewardsValidUntil, { date: expiry })}
                    </Text>
                  ) : null}
                </View>
                {error ? <Text style={styles.error}>{t.rewardsArmFailed}</Text> : null}
                <PrimaryButton
                  label={armed ? t.rewardsTurnOff : t.rewardsUseNext}
                  tone={armed ? "gold" : "red"}
                  busy={busy}
                  onPress={() => void toggle(!armed)}
                />
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>
                  {fill(t.rewardsToGo, { points: missing, value })}
                </Text>
                <View style={{ gap: 8 }}>
                  <PointsBar have={loyalty?.balance ?? 0} need={rewardPoints} />
                  <Text style={styles.progressText}>
                    {loyalty?.balance ?? 0} / {rewardPoints} {t.rewardsPoints}
                  </Text>
                </View>
                {justUsed ? (
                  <Text style={styles.usedNote}>
                    🎁{" "}
                    {fill(t.rewardsUsedOn, {
                      number: orderNo(justUsed.redeemedOrderNumber ?? 0),
                    })}
                  </Text>
                ) : null}
              </>
            )}

            <Pressable onPress={onClose} hitSlop={8} style={styles.closeRow}>
              <Text style={styles.closeText}>{t.close}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  trackFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.goldSoft },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,5,0.5)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 4,
  },
  sheetKicker: {
    color: colors.gold,
    ...fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    textAlign: "center",
  },
  sheetTitle: {
    color: colors.ink,
    ...fonts.display,
    fontSize: 24,
    lineHeight: 31,
    textAlign: "center",
  },
  voucher: {
    backgroundColor: colors.creamCard,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 3,
  },
  voucherValue: { color: colors.red, ...fonts.bodyHeavy, fontSize: 20 },
  voucherMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  progressText: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13, textAlign: "center" },
  usedNote: { color: colors.gold, ...fonts.bodySemi, fontSize: 13, textAlign: "center" },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, textAlign: "center" },
  closeRow: { alignItems: "center", paddingTop: 2 },
  closeText: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13 },
});

/**
 * Points a basket's FOOD value earns — `pointsPerOrder` for every FULL
 * `minOrderCents` step (5 per €20 at the defaults; €45 ⇒ 10). Mirrors the
 * server's `pointsForFood` (src/lib/loyalty-points.ts), which is what
 * actually credits the ledger; this is only the cart's preview of it.
 */
export function pointsForFood(
  config: { minOrderCents: number; pointsPerOrder: number },
  foodCents: number,
): number {
  if (config.pointsPerOrder <= 0 || foodCents <= 0) return 0;
  if (config.minOrderCents <= 0) return config.pointsPerOrder;
  return Math.floor(foodCents / config.minOrderCents) * config.pointsPerOrder;
}
