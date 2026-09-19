import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../auth";
import type { StaffLoyalty } from "../staff";
import { fetchStaffLoyalty } from "../staff";
import { BrandHeader } from "../components";
import { fill, localeTag, useI18n } from "../i18n";
import { colors, fonts, money, radius } from "../theme";

/**
 * The restaurant's view of the loyalty programme: the rules it is running
 * on, what those rules have added up to, and who is collecting.
 *
 * Read-only on purpose. The programme's numbers are a pricing decision —
 * changing "points per order" from a phone mid-service is how a venue
 * ends up owing rewards it didn't mean to offer — so the screen says
 * where to change them instead. The guests' own Rewards card is
 * untouched; this is the same programme seen from behind the counter.
 */
export function LoyaltyStaffScreen({
  currency,
  onBack,
  onOpenOwnerMenu,
}: {
  currency: string;
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const [data, setData] = useState<StaffLoyalty | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tag = localeTag(lang);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffLoyalty(staffToken);
    setLoaded(true);
    if (res.ok) {
      setData(res.data);
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    // Keep whatever is on screen: a stale table beats an empty one.
    else setFailed(true);
  }, [staffToken, clearStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const dateOf = (iso: string | null): string => {
    if (!iso) return t.staffLoyaltyNoOrder;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t.staffLoyaltyNoOrder;
    return fill(t.staffLoyaltyLastOrder, {
      date: d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit", year: "2-digit" }),
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.staffLoyaltyTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.red}
          />
        }
      >
        {!loaded ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
        ) : !data ? (
          <Text style={styles.failed}>{t.staffLoadFailed}</Text>
        ) : (
          <>
            {failed ? <Text style={styles.failed}>{t.staffLoadFailed}</Text> : null}

            <View style={[styles.banner, data.enabled ? styles.bannerOn : styles.bannerOff]}>
              <Text style={styles.bannerEmoji}>{data.enabled ? "🎁" : "💤"}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.bannerTitle}>
                  {data.enabled ? t.staffLoyaltyOn : t.staffLoyaltyOff}
                </Text>
                {data.enabled ? null : (
                  <Text style={styles.bannerHint}>{t.staffLoyaltyOffHint}</Text>
                )}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.staffLoyaltyProgramme}</Text>
              <ConfigRow
                label={t.staffLoyaltyMinOrder}
                value={money(data.config.minOrderCents, currency)}
              />
              <ConfigRow
                label={t.staffLoyaltyPerOrder}
                value={String(data.config.pointsPerOrder)}
              />
              <ConfigRow
                label={t.staffLoyaltyRewardPoints}
                value={String(data.config.rewardPoints)}
              />
              <ConfigRow
                label={t.staffLoyaltyRewardValue}
                value={money(data.config.rewardValueCents, currency)}
              />
              <ConfigRow
                label={t.staffLoyaltyExpiry}
                value={fill(t.staffLoyaltyMonths, { months: data.config.voucherExpiryMonths })}
              />
            </View>

            <View style={styles.tiles}>
              <Tile label={t.staffLoyaltyMembers} value={data.totals.members} />
              <Tile label={t.staffLoyaltyPointsOut} value={data.totals.pointsOutstanding} />
              <Tile label={t.staffLoyaltyVouchers} value={data.totals.vouchersAvailable} gold />
              <Tile label={t.staffLoyaltyRedeemed} value={data.totals.vouchersRedeemed30d} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.staffLoyaltyGuests}</Text>
              {data.members.length === 0 ? (
                <Text style={styles.empty}>{t.staffLoyaltyEmpty}</Text>
              ) : (
                data.members.map((m) => (
                  <View key={m.customerId} style={styles.memberRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.name ?? m.email ?? "—"}
                      </Text>
                      <Text style={styles.memberMeta} numberOfLines={1}>
                        {dateOf(m.lastOrderAt)}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <Text style={styles.memberPoints}>
                        {fill(t.staffLoyaltyPoints, { points: m.balance })}
                      </Text>
                      {m.vouchersAvailable > 0 ? (
                        <View style={styles.rewardPill}>
                          <Text style={styles.rewardPillText}>
                            {fill(t.staffLoyaltyRewardsReady, { count: m.vouchersAvailable })}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.configRow}>
      <Text style={styles.configLabel}>{label}</Text>
      <Text style={styles.configValue}>{value}</Text>
    </View>
  );
}

function Tile({
  label,
  value,
  gold,
}: {
  label: string;
  value: number;
  gold?: boolean;
}): React.ReactElement {
  return (
    <View style={[styles.tile, gold && styles.tileGold]}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerOn: { backgroundColor: colors.creamCard, borderColor: colors.goldSoft },
  bannerOff: { backgroundColor: colors.creamCard, borderColor: colors.line },
  bannerEmoji: { ...fonts.body, fontSize: 24 },
  bannerTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 15 },
  bannerHint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
  },
  cardTitle: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 15, marginBottom: 2 },
  configRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 3,
  },
  configLabel: { flex: 1, color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  configValue: { color: colors.ink, ...fonts.bodySemi, fontSize: 13.5 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  // Two up on a phone, four across on a tablet — the tiles size
  // themselves off the row rather than a breakpoint.
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  tileGold: { borderColor: colors.goldSoft },
  tileValue: { color: colors.red, ...fonts.displayHeavy, fontSize: 24 },
  tileLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11.5 },
  empty: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  memberName: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  memberMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  memberPoints: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 13.5 },
  rewardPill: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rewardPillText: { color: colors.ink, ...fonts.bodyBold, fontSize: 10.5 },
});
