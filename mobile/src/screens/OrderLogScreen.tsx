import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { BrandHeader } from "../components";
import { localeTag, useI18n } from "../i18n";
import { useLayout } from "../layout";
import type { OrderLogFilter, StaffOrderLogDetail, StaffOrderLogRow } from "../staff";
import { fetchStaffOrderLog, fetchStaffOrderLogDetail } from "../staff";
import { colors, fonts, money, radius } from "../theme";

/**
 * Order history (owner, 2026-10-14): the dashboard's Order log on the
 * phone — for the owner and for team logins with the Orders box. A day's
 * orders (or a 6-month search), and per order everything that came in and
 * happened, to the millisecond, each step's raw JSON a tap away.
 */

const FILTERS: readonly OrderLogFilter[] = ["all", "payment_open", "payment_failed", "deleted"];
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function OrderLogScreen({
  currency,
  onBack,
  onOpenOwnerMenu,
}: {
  currency: string;
  onBack?: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const tag = localeTag(lang);

  const [day, setDay] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<OrderLogFilter>("all");
  const [rows, setRows] = useState<StaffOrderLogRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffOrderLogDetail | null>(null);
  const [rawOpen, setRawOpen] = useState<ReadonlySet<string>>(new Set());
  const seq = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!staffToken) return;
    const mine = ++seq.current;
    const res = await fetchStaffOrderLog(staffToken, { date: day, q: search, filter });
    if (mine !== seq.current) return;
    if (res.ok) {
      setRows(res.data.orders);
      if (day === null) setToday(res.data.date);
      setFailed(false);
      return;
    }
    if (res.error === "unauthorized") clearStaff();
    else setFailed(true);
  }, [staffToken, clearStaff, day, search, filter]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!openId || !staffToken) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    setRawOpen(new Set());
    void fetchStaffOrderLogDetail(staffToken, openId).then((res) => {
      if (!alive) return;
      if (res.ok) setDetail(res.data);
      else if (res.error === "unauthorized") clearStaff();
    });
    return () => {
      alive = false;
    };
  }, [openId, staffToken, clearStaff]);

  const shown = day ?? today;
  const isToday = shown !== null && shown === today;
  const filterLabel: Record<OrderLogFilter, string> = {
    all: t.orderLogAll,
    payment_open: t.orderLogOpen,
    payment_failed: t.orderLogFailed,
    deleted: t.orderLogDeleted,
  };
  const typeLabel = (type: string | null): string =>
    type === "delivery"
      ? t.delivery
      : type === "takeaway"
        ? t.pickup
        : type === "dine_in"
          ? t.dineIn
          : "";
  const pill = (r: StaffOrderLogRow): { text: string; bg: string; fg: string } => {
    if (r.deleted) return { text: t.orderLogDeleted, bg: colors.line, fg: colors.inkSoft };
    if (r.failed && r.paymentStatus !== "paid")
      return { text: t.orderLogFailed, bg: "#f8e0e0", fg: colors.danger };
    if (r.paymentStatus === "pending")
      return { text: t.orderLogOpen, bg: "#fdf0d8", fg: "#8a5a00" };
    const status = (t.statusShort as Record<string, string>)[r.status ?? ""] ?? r.status ?? "—";
    return { text: status, bg: colors.cream, fg: colors.ink };
  };
  const timeOf = (iso: string, ms = false): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const s = d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return ms ? `${s}.${String(d.getMilliseconds()).padStart(3, "0")}` : s;
  };

  // ---- One order -----------------------------------------------------
  if (openId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream }}>
        <BrandHeader
          title={detail?.row.label ?? t.orderLogTitle}
          onBack={() => setOpenId(null)}
          onMenu={onOpenOwnerMenu}
        />
        <ScrollView
          contentContainerStyle={{
            padding: layout.pad,
            paddingBottom: 40,
            gap: 12,
            ...layout.content,
          }}
        >
          {!detail ? (
            <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
          ) : (
            <>
              <View style={styles.headRow}>
                <Text style={styles.big}>
                  {detail.row.label} ·{" "}
                  {detail.row.totalCents == null ? "—" : money(detail.row.totalCents, currency)}
                </Text>
                <View style={[styles.pill, { backgroundColor: pill(detail.row).bg }]}>
                  <Text style={[styles.pillText, { color: pill(detail.row).fg }]}>
                    {pill(detail.row).text}
                  </Text>
                </View>
              </View>
              <Text style={styles.meta} selectable>
                ID {detail.row.orderId}
                {detail.row.channel ? ` · ${detail.row.channel === "app" ? "App" : "Website"}` : ""}
              </Text>

              <View style={styles.box}>
                <Text style={styles.boxTitle}>{t.orderLogGuest}</Text>
                <Text style={styles.strong}>{detail.guest.name ?? "—"}</Text>
                {detail.guest.phone ? <Text style={styles.text}>{detail.guest.phone}</Text> : null}
                {detail.guest.email ? <Text style={styles.text}>{detail.guest.email}</Text> : null}
                {detail.guest.table ? <Text style={styles.text}>{detail.guest.table}</Text> : null}
              </View>
              <View style={styles.box}>
                <Text style={styles.boxTitle}>{t.orderLogOrder}</Text>
                <Text style={styles.text}>{typeLabel(detail.row.orderType) || "—"}</Text>
                {detail.guest.address ? (
                  <Text style={styles.text}>{detail.guest.address}</Text>
                ) : null}
                {detail.items.map((i, n) => (
                  <Text key={n} style={styles.text}>
                    {i.quantity}× {i.name}
                  </Text>
                ))}
              </View>
              <View style={styles.box}>
                <Text style={styles.boxTitle}>{t.orderLogPayment}</Text>
                <Text style={styles.text}>
                  {detail.row.payment ?? "—"}
                  {detail.row.paymentStatus ? ` · ${detail.row.paymentStatus}` : ""}
                </Text>
                {detail.paymentRef ? (
                  <Text style={styles.mono} selectable>
                    {detail.paymentRef}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.section}>{t.orderLogHistory}</Text>
              <View style={styles.timeline}>
                {detail.events.map((e) => {
                  const open = rawOpen.has(e.id);
                  return (
                    <View key={e.id} style={styles.event}>
                      <View style={styles.dot} />
                      <Text style={styles.text}>
                        <Text style={styles.time}>{timeOf(e.createdAt)} </Text>
                        <Text style={styles.strong}>
                          {(t.orderLogKinds as Record<string, string>)[e.kind] ?? e.kind}
                        </Text>
                        {e.summary ? <Text style={styles.meta}> · {e.summary}</Text> : null}
                        <Text style={styles.meta}> · {e.actor}</Text>
                      </Text>
                      {e.payload != null ? (
                        <Pressable
                          onPress={() =>
                            setRawOpen((prev) => {
                              const next = new Set(prev);
                              if (!next.delete(e.id)) next.add(e.id);
                              return next;
                            })
                          }
                          accessibilityRole="button"
                          hitSlop={6}
                        >
                          <Text style={styles.link}>
                            {open ? "▾" : "▸"} {t.orderLogRaw} · {timeOf(e.createdAt, true)}
                          </Text>
                        </Pressable>
                      ) : null}
                      {open ? (
                        <ScrollView horizontal style={styles.json}>
                          <Text style={styles.jsonText} selectable>
                            {JSON.stringify(e.payload, null, 2)}
                          </Text>
                        </ScrollView>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <Text style={styles.meta}>🔒 {t.orderLogKept}</Text>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ---- The list -------------------------------------------------------
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.orderLogTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 40,
          gap: 12,
          ...layout.content,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.red}
          />
        }
      >
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.inkSoft} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => setSearch(query)}
            returnKeyType="search"
            placeholder={t.orderLogSearch}
            placeholderTextColor={colors.inkSoft}
            style={styles.searchInput}
            accessibilityLabel={t.orderLogSearch}
          />
          {search ? (
            <Pressable
              onPress={() => {
                setQuery("");
                setSearch("");
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.close}
            >
              <Ionicons name="close-circle" size={18} color={colors.inkSoft} />
            </Pressable>
          ) : null}
        </View>

        {!search ? (
          <View style={styles.dayRow}>
            <Pressable
              onPress={() => shown && setDay(shiftDay(shown, -1))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.salesPrevDay}
              style={styles.dayBtn}
            >
              <Ionicons name="chevron-back" size={20} color={colors.ink} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={styles.dayTitle}>
                {shown
                  ? new Date(`${shown}T12:00:00Z`).toLocaleDateString(tag, {
                      weekday: "short",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      timeZone: "UTC",
                    })
                  : ""}
              </Text>
              {!isToday && shown ? (
                <Pressable onPress={() => setDay(null)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>{t.salesToday}</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => {
                if (!shown || isToday) return;
                const next = shiftDay(shown, 1);
                setDay(today && next >= today ? null : next);
              }}
              disabled={isToday}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.salesNextDay}
              style={[styles.dayBtn, isToday && { opacity: 0.3 }]}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.ink} />
            </Pressable>
          </View>
        ) : null}

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
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{filterLabel[f]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {rows === null ? (
          failed ? (
            <Text style={styles.failedText}>{t.staffLoadFailed}</Text>
          ) : (
            <ActivityIndicator color={colors.red} style={{ marginTop: 24 }} />
          )
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>{t.orderLogEmpty}</Text>
        ) : (
          <View style={styles.card}>
            {rows.map((r, i) => {
              const p = pill(r);
              return (
                <Pressable
                  key={r.orderId}
                  onPress={() => setOpenId(r.orderId)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && styles.rowRule,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.label}>{r.label}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.text} numberOfLines={1}>
                      {[r.guest, typeLabel(r.orderType), r.payment].filter(Boolean).join(" · ")}
                    </Text>
                    <Text style={styles.meta}>
                      {timeOf(r.firstAt)}
                      {r.channel ? ` · ${r.channel === "app" ? "App" : "Website"}` : ""}
                    </Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: p.bg }]}>
                    <Text style={[styles.pillText, { color: p.fg }]}>{p.text}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  failedText: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  empty: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  searchInput: { flex: 1, color: colors.ink, ...fonts.body, fontSize: 14.5, paddingVertical: 10 },
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
  dayTitle: { color: colors.ink, ...fonts.display, fontSize: 17 },
  link: { color: colors.red, ...fonts.bodyBold, fontSize: 12.5 },
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
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
  rowRule: { borderTopWidth: 1, borderTopColor: colors.line },
  label: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 14.5, minWidth: 46 },
  text: { color: colors.ink, ...fonts.body, fontSize: 13.5 },
  strong: { color: colors.ink, ...fonts.bodyBold, fontSize: 13.5 },
  meta: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  time: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { ...fonts.bodyBold, fontSize: 11 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  big: { color: colors.ink, ...fonts.display, fontSize: 22, flexShrink: 1 },
  box: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 12,
    gap: 2,
  },
  boxTitle: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  mono: { color: colors.inkSoft, fontFamily: MONO, fontSize: 11.5 },
  section: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 6,
  },
  timeline: {
    borderLeftWidth: 2,
    borderLeftColor: colors.line,
    marginLeft: 6,
    paddingLeft: 14,
    gap: 8,
  },
  event: { position: "relative", gap: 3 },
  dot: {
    position: "absolute",
    left: -21,
    top: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: colors.cream,
  },
  json: { backgroundColor: "#1f1a16", borderRadius: radius.md, padding: 10, maxHeight: 360 },
  jsonText: { color: "#e8dcc8", fontFamily: MONO, fontSize: 11 },
});
