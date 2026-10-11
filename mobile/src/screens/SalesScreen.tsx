import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import type { SalesFilter, SalesPayment, StaffSales, StaffSalesOrder } from "../staff";
import { fetchStaffSales } from "../staff";
import { BrandHeader } from "../components";
import { DeleteOrderSheet } from "../delete-order-sheet";
import { fill, localeTag, useI18n, type Strings } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, money, radius } from "../theme";

/**
 * "Tagesumsatz" — one day's sales on the restaurant phone (owner,
 * 2026-10-11): cash and online totals, the split by payment type, and the
 * day's orders with a payment filter. Owner and team logins with the
 * "reports" box see it.
 *
 * The owner can delete an order from here only where the server allows
 * it — a cancelled order nobody paid for. Paid orders stay in the books:
 * German tax law (GoBD, §146 AO) does not allow them to vanish, so their
 * rows carry no delete button.
 */

const FILTERS: readonly SalesFilter[] = [
  "all",
  "cash",
  "online",
  "paypal",
  "apple_pay",
  "google_pay",
  "stripe",
];

function payLabel(t: Strings, key: SalesFilter): string {
  switch (key) {
    case "all":
      return t.salesAll;
    case "cash":
      return t.salesCash;
    case "online":
      return t.salesOnline;
    case "paypal":
      return "PayPal";
    case "apple_pay":
      return "Apple Pay";
    case "google_pay":
      return "Google Pay";
    case "stripe":
      return t.salesCard;
    case "voucher":
      return t.salesVoucher;
  }
}

function typeLabel(t: Strings, o: StaffSalesOrder): string {
  if (o.orderType === "delivery") return t.delivery;
  if (o.orderType === "takeaway") return t.pickup;
  return o.tableNumber ? fill(t.salesTable, { table: o.tableNumber }) : t.dineIn;
}

/** YYYY-MM-DD shifted by `days`, calendar arithmetic only. */
function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function SalesScreen({
  onBack,
  onOpenOwnerMenu,
}: {
  onBack?: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff, staffCan } = useAuth();
  const layout = useLayout();
  const tag = localeTag(lang);
  const isOwner = staffCan("owner");

  /** null = today (the server's today, in the restaurant's time zone). */
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<SalesFilter>("all");
  const [data, setData] = useState<StaffSales | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toDelete, setToDelete] = useState<StaffSalesOrder | null>(null);

  /** Only the latest request may land — quick taps on ← fire several. */
  const seq = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const mine = ++seq.current;
    const res = await fetchStaffSales(staffToken, day, filter);
    if (mine !== seq.current) return;
    setLoading(false);
    if (res.ok) {
      setData(res.data);
      if (day === null) setToday(res.data.date);
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    else setFailed(true);
  }, [staffToken, clearStaff, day, filter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const shown = day ?? today ?? data?.date ?? null;
  const isToday = shown !== null && today !== null && shown === today;
  const go = (delta: number): void => {
    if (!shown) return;
    const next = shiftDay(shown, delta);
    setDay(today !== null && next >= today ? null : next);
  };

  const dayTitle = shown
    ? new Date(`${shown}T12:00:00Z`).toLocaleDateString(tag, {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  const clock = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  };
  const currency = data?.currency ?? "EUR";

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.ownerSales} onBack={onBack} onMenu={onOpenOwnerMenu} />
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
        {/* Day switcher */}
        <View style={styles.dayRow}>
          <Pressable
            onPress={() => go(-1)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t.salesPrevDay}
            style={({ pressed }) => [styles.dayBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.dayTitle} numberOfLines={1}>
              {dayTitle}
            </Text>
            {!isToday && shown ? (
              <Pressable onPress={() => setDay(null)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>{t.salesToday}</Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => go(1)}
            disabled={isToday}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t.salesNextDay}
            accessibilityState={{ disabled: isToday }}
            style={({ pressed }) => [
              styles.dayBtn,
              isToday && { opacity: 0.3 },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.ink} />
          </Pressable>
        </View>

        {loading && !data ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
        ) : !data ? (
          <Text style={styles.failed}>{t.staffLoadFailed}</Text>
        ) : (
          <>
            {failed ? <Text style={styles.failed}>{t.staffLoadFailed}</Text> : null}

            <View style={styles.tiles}>
              <Tile
                label={t.salesTotal}
                amount={money(data.totals.grossCents, currency)}
                count={data.totals.orders}
                strong
              />
              <Tile
                label={t.salesCash}
                amount={money(data.totals.cashCents, currency)}
                count={data.totals.cashOrders}
              />
              <Tile
                label={t.salesOnline}
                amount={money(data.totals.onlineCents, currency)}
                count={data.totals.onlineOrders}
              />
            </View>

            {data.byPaymentMethod.length > 0 ? (
              <View style={styles.card}>
                {data.byPaymentMethod.map((m, i) => (
                  <View key={m.key} style={[styles.splitRow, i > 0 && styles.rowRule]}>
                    <Text style={styles.splitLabel}>{payLabel(t, m.key as SalesPayment)}</Text>
                    <Text style={styles.splitMeta}>
                      {fill(t.salesOrdersCount, { count: String(m.orders) })}
                    </Text>
                    <Text style={styles.splitAmount}>{money(m.totalCents, currency)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Payment filter — narrows the list below, not the tiles. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {FILTERS.map((f) => {
                const on = filter === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{payLabel(t, f)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {filter !== "all" ? (
              <Text style={styles.meta}>
                {fill(t.salesFiltered, {
                  count: String(data.filtered.orders),
                  amount: money(data.filtered.totalCents, currency),
                })}
              </Text>
            ) : null}

            {data.orders.length === 0 ? (
              <Text style={styles.empty}>{t.salesEmpty}</Text>
            ) : (
              <View style={styles.card}>
                {data.orders.map((o, i) => (
                  <View key={o.id} style={[styles.row, i > 0 && styles.rowRule]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.rowTitle}>
                        #{o.orderLabel}
                        <Text style={styles.rowTime}> · {clock(o.placedAt)}</Text>
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {typeLabel(t, o)} · {payLabel(t, o.paymentMethod)}
                        {o.customerName ? ` · ${o.customerName}` : ""}
                      </Text>
                      {o.status === "cancelled" || !o.countsAsRevenue ? (
                        <Text style={styles.rowWarn}>
                          {o.status === "cancelled" ? t.statusShort.cancelled : t.salesNotCounted}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.rowAmount, !o.countsAsRevenue && styles.rowAmountOff]}>
                      {money(o.totalCents, currency)}
                    </Text>
                    {isOwner && o.deletable ? (
                      <Pressable
                        onPress={() => setToDelete(o)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={fill(t.boardDeleteTitle, { number: o.orderLabel })}
                        style={({ pressed }) => [styles.trash, pressed && { opacity: 0.6 }]}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
            {isOwner ? <Text style={styles.hint}>{t.salesKeepHint}</Text> : null}
          </>
        )}
      </ScrollView>

      <DeleteOrderSheet
        order={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={() => {
          setToDelete(null);
          void load();
        }}
      />
    </View>
  );
}

function Tile({
  label,
  amount,
  count,
  strong,
}: {
  label: string;
  amount: string;
  count: number;
  strong?: boolean;
}): React.ReactElement {
  return (
    <View
      style={[styles.tile, strong && styles.tileStrong]}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${amount}, ${count}`}
    >
      <Text style={[styles.tileValue, strong && { color: colors.onRed }]}>{amount}</Text>
      <Text style={[styles.tileLabel, strong && { color: colors.onRed }]} numberOfLines={1}>
        {label} · {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  failed: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  empty: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5, lineHeight: 16 },
  meta: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  link: { color: colors.red, ...fonts.bodyBold, fontSize: 12.5, textDecorationLine: "underline" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.creamCard,
    alignItems: "center",
    justifyContent: "center",
  },
  dayTitle: { color: colors.ink, ...fonts.display, fontSize: 18 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 2,
  },
  tileStrong: { backgroundColor: colors.red, borderColor: colors.red, flexBasis: "100%" },
  tileValue: { color: colors.red, ...fonts.displayHeavy, fontSize: 20 },
  tileLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11.5 },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
  },
  splitRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  splitLabel: { flex: 1, color: colors.ink, ...fonts.bodySemi, fontSize: 13.5 },
  splitMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  splitAmount: {
    color: colors.ink,
    ...fonts.bodyBold,
    fontSize: 13.5,
    minWidth: 76,
    textAlign: "right",
  },
  chips: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.creamCard,
    paddingVertical: 6,
    paddingHorizontal: 14,
    minHeight: 36,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.ink, ...fonts.bodySemi, fontSize: 13 },
  chipTextOn: { color: colors.onRed, ...fonts.bodyBold },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  rowRule: { borderTopWidth: 1, borderTopColor: colors.line },
  rowTitle: { color: colors.ink, ...fonts.bodyBold, fontSize: 14.5 },
  rowTime: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  rowMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  rowWarn: { color: colors.danger, ...fonts.bodySemi, fontSize: 11.5 },
  rowAmount: { color: colors.ink, ...fonts.bodyBold, fontSize: 14.5 },
  rowAmountOff: { color: colors.inkSoft, textDecorationLine: "line-through" },
  trash: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
});
