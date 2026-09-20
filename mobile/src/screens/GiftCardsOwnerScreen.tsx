import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../auth";
import type { StaffGiftCards } from "../staff";
import { fetchStaffGiftCards } from "../staff";
import { GiftCardStatusBadge } from "../gift-card-card";
import { BrandHeader } from "../components";
import { fill, localeTag, useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, money, radius } from "../theme";

/**
 * The venue's gift-card book, on the owner's phone — the same three
 * numbers and the same rows as the dashboard page.
 *
 * `outstanding` is the one that matters to the accountant rather than to
 * the counter: money already taken that the kitchen still owes food for.
 * A gift card is a multi-purpose voucher (Mehrzweckgutschein), so VAT
 * falls due at REDEMPTION, not at sale — which is why the three totals
 * are kept apart instead of being netted into one.
 */
export function GiftCardsOwnerScreen({
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
  const layout = useLayout();
  const tag = localeTag(lang);
  const [data, setData] = useState<StaffGiftCards | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const res = await fetchStaffGiftCards(staffToken);
    setLoaded(true);
    if (res.ok) {
      setData(res.data);
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
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
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(tag, { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.ownerGiftCards} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 40,
          gap: 14,
          ...layout.content,
        }}
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

            <View style={styles.tiles}>
              <Tile
                label={t.giftCardsOwnerSold}
                amount={money(data.totals.soldCents, currency)}
                count={data.totals.soldCount}
              />
              <Tile
                label={t.giftCardsOwnerRedeemed}
                amount={money(data.totals.redeemedCents, currency)}
                count={data.totals.redeemedCount}
              />
              <Tile
                label={t.giftCardsOwnerOutstanding}
                amount={money(data.totals.outstandingCents, currency)}
                count={data.totals.outstandingCount}
                gold
              />
            </View>

            {data.cards.length === 0 ? (
              <Text style={styles.empty}>{t.giftCardsMineEmpty}</Text>
            ) : (
              <View style={styles.card}>
                {data.cards.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.rowValue}>
                        {money(c.valueCents, c.currency)}
                        {c.productName ? ` · ${c.productName}` : ""}
                      </Text>
                      <Text style={styles.rowCode}>{c.codeFormatted}</Text>
                      {c.buyerName ? (
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {fill(t.giftCardBuyer, { name: c.buyerName })}
                        </Text>
                      ) : null}
                      {dateOf(c.paidAt ?? c.createdAt) ? (
                        <Text style={styles.rowMeta}>{dateOf(c.paidAt ?? c.createdAt)}</Text>
                      ) : null}
                    </View>
                    <GiftCardStatusBadge status={c.status} />
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Tile({
  label,
  amount,
  count,
  gold,
}: {
  label: string;
  amount: string;
  count: number;
  gold?: boolean;
}): React.ReactElement {
  return (
    <View
      style={[styles.tile, gold && styles.tileGold]}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${amount}, ${count}`}
    >
      <Text style={styles.tileValue}>{amount}</Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label} · {count}
      </Text>
    </View>
  );
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const styles = StyleSheet.create({
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  empty: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
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
  tileValue: { color: colors.red, ...fonts.displayHeavy, fontSize: 20 },
  tileLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11.5 },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  rowValue: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  rowCode: { color: colors.inkSoft, fontFamily: MONO, fontSize: 12, letterSpacing: 1 },
  rowMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
});
