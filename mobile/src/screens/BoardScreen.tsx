import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { useAuth } from "../auth";
import type { StaffOrder } from "../staff";
import { advanceStaffOrder, fetchStaffOrders, isClosedStatus } from "../staff";
import { BrandHeader } from "../components";
import { colors, fonts, money, radius } from "../theme";
import { fill, localeTag, useI18n } from "../i18n";

/**
 * The restaurant's board — every live order, in one screen the counter
 * can read from arm's length.
 *
 * Rules it lives by:
 *
 *  - The SERVER owns the lifecycle. Each card renders one button per
 *    entry in that order's `allowedNext`; the app never derives the chain,
 *    so a venue that grows "out for delivery" (or drops it) needs no
 *    release here.
 *  - A 409 is not an error the owner caused: someone else already moved
 *    that order on. Say so quietly and re-read the board.
 *  - Never go blank. Offline keeps the last list under a "Reconnecting…"
 *    line, because a kitchen mid-service would rather have a stale board
 *    than an empty one.
 *  - The screen stays awake while it is open (a tablet on the pass must
 *    not sleep between orders).
 */

/** How often the board re-reads while it is the visible tab. */
const POLL_MS = 10_000;
/** Every Nth poll asks for the WHOLE board instead of the delta, so an
 *  order that rolled off (yesterday's "done") eventually disappears. */
const FULL_EVERY = 6;
/** How long a newly-arrived card stays lit. */
const HIGHLIGHT_MS = 20_000;

const TYPE_ICONS: Record<string, string> = {
  dine_in: "🍽️",
  takeaway: "🛍️",
  delivery: "🛵",
};

const METHOD_ICONS: Record<string, string> = {
  card: "💳",
  stripe: "💳",
  paypal: "🅿️",
  cash: "💶",
  voucher: "🎁",
};

/** Same day in the DEVICE's timezone — "today" is the restaurant's day. */
function isToday(iso: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function BoardScreen(): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  // A board nobody can read is no board: hold the screen on while it is
  // the visible tab, and release it the moment it isn't.
  useKeepAwake();

  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Per-order footnote: the order moved on without us, or the request
   *  simply failed. Said once, then it gets out of the way. */
  const [note, setNote] = useState<{ id: string; kind: "moved" | "failed" } | null>(null);
  const [fresh, setFresh] = useState<readonly string[]>([]);

  /** Server clock from the last successful read — the `since` cursor. */
  const sinceRef = useRef<string | null>(null);
  /** Every order id this session has ever seen. Null until the first
   *  read lands, so a cold start doesn't buzz for the whole board. */
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const tag = localeTag(lang);
  const timeOf = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      if (!iso || Number.isNaN(d.getTime())) return "";
      return d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
    },
    [tag],
  );

  const load = useCallback(
    async (mode: "full" | "delta"): Promise<void> => {
      if (!staffToken) return;
      const res = await fetchStaffOrders(staffToken, mode === "delta" ? sinceRef.current : null);
      if (!res.ok) {
        if (res.error === "unauthorized") {
          clearStaff();
          return;
        }
        setOffline(true);
        setLoaded(true);
        return;
      }
      setOffline(false);
      setLoaded(true);
      sinceRef.current = res.data.serverTime;

      const seen = seenRef.current;
      const nextSeen = new Set(seen ?? []);
      const arrived: string[] = [];
      for (const order of res.data.orders) {
        if (seen && !seen.has(order.id) && !isClosedStatus(order.status)) arrived.push(order.id);
        nextSeen.add(order.id);
      }
      seenRef.current = nextSeen;

      setOrders((prev) => {
        const byId = new Map<string, StaffOrder>();
        // A delta only carries what changed, so it is layered onto what
        // we have; a full read replaces the board outright.
        if (mode === "delta") for (const o of prev) byId.set(o.id, o);
        for (const o of res.data.orders) byId.set(o.id, o);
        return [...byId.values()];
      });

      if (arrived.length > 0) {
        // One short buzz, not a ringtone: the kitchen is a quiet room.
        Vibration.vibrate(250);
        setFresh((prevFresh) => [...prevFresh, ...arrived]);
        const timer = setTimeout(() => {
          timersRef.current = timersRef.current.filter((x) => x !== timer);
          setFresh((prevFresh) => prevFresh.filter((id) => !arrived.includes(id)));
        }, HIGHLIGHT_MS);
        timersRef.current.push(timer);
      }
    },
    [staffToken, clearStaff],
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!staffToken) return;
    let cancelled = false;
    let busy = false;
    let ticks = 0;
    const cycle = async (mode: "full" | "delta"): Promise<void> => {
      // One request at a time: a slow network must not stack up polls.
      if (cancelled || busy) return;
      busy = true;
      try {
        await loadRef.current(mode);
      } finally {
        busy = false;
      }
    };
    void cycle("full");
    const interval = setInterval(() => {
      ticks += 1;
      void cycle(ticks % FULL_EVERY === 0 ? "full" : "delta");
    }, POLL_MS);
    // Back from the lock screen or another app: the board is stale by
    // definition, so re-read the whole thing at once.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void cycle("full");
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [staffToken]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
    },
    [],
  );

  /** Both footnotes are news, not state — they fade on their own. */
  const say = useCallback((id: string, kind: "moved" | "failed") => {
    setNote({ id, kind });
    const timer = setTimeout(() => {
      timersRef.current = timersRef.current.filter((x) => x !== timer);
      setNote((current) =>
        current && current.id === id && current.kind === kind ? null : current,
      );
    }, 6_000);
    timersRef.current.push(timer);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load("full").finally(() => setRefreshing(false));
  }, [load]);

  async function advance(order: StaffOrder, to: string): Promise<void> {
    if (!staffToken || busyId) return;
    setNote(null);
    setBusyId(order.id);
    const res = await advanceStaffOrder(staffToken, order.id, to);
    setBusyId(null);
    if (res.ok) {
      const updated = res.data;
      if (updated) setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      else void load("full");
      return;
    }
    if (res.error === "unauthorized") {
      clearStaff();
      return;
    }
    if (res.error === "conflict") {
      // Someone at the pass got there first — the board, not the owner,
      // was wrong. Re-read and say so in one line.
      say(order.id, "moved");
      void load("full");
      return;
    }
    say(order.id, "failed");
  }

  function callPhone(phone: string): void {
    void Linking.openURL(`tel:${phone.replace(/[^+\d]/g, "")}`).catch(() => {});
  }

  function openDirections(order: StaffOrder): void {
    const a = order.deliveryAddress;
    if (!a) return;
    const query = [a.street, [a.zip, a.city].filter(Boolean).join(" ").trim()]
      .filter(Boolean)
      .join(", ");
    if (!query) return;
    const encoded = encodeURIComponent(query);
    // Each platform's own maps handoff, with the web map as the net when
    // no maps app answers the scheme.
    const native = Platform.OS === "ios" ? `maps://?daddr=${encoded}` : `geo:0,0?q=${encoded}`;
    void Linking.openURL(native).catch(() => {
      void Linking.openURL(`https://maps.google.com/?q=${encoded}`).catch(() => {});
    });
  }

  const statusShort = t.statusShort as Record<string, string>;
  const typeLabels = t.typeLabels as Record<string, string>;
  const payShort = t.payShort as { paid: string; unpaid: string };

  const open = orders
    .filter((o) => !isClosedStatus(o.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const doneToday = orders
    .filter((o) => isClosedStatus(o.status) && isToday(o.updatedAt || o.createdAt))
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));

  function renderCard(order: StaffOrder, closed: boolean): React.ReactElement {
    const lit = fresh.includes(order.id);
    const placed = timeOf(order.createdAt);
    const planned = order.requestedFor ? timeOf(order.requestedFor) : "";
    const typeText =
      order.orderType === "dine_in" && order.tableNumber
        ? `${t.table} ${order.tableNumber}`
        : (typeLabels[order.orderType] ?? order.orderType);

    // Payment, said the way the Orders screen says it: a reward that
    // covered the bill IS the method, a settled order is green, and
    // anything still owed stays quiet rather than shouting.
    const byReward = order.paymentProvider === "voucher";
    const paid = order.paymentStatus === "paid";
    const methodIcon = METHOD_ICONS[order.paymentProvider ?? ""] ?? "💶";
    const pay = byReward
      ? { icon: "🎁", text: t.ordersRewardPill, settled: true }
      : paid
        ? { icon: methodIcon, text: payShort.paid, settled: true }
        : order.paymentProvider === "cash"
          ? { icon: "💶", text: t.methodCash, settled: false }
          : { icon: methodIcon, text: payShort.unpaid, settled: false };
    const discountCents = byReward ? 0 : order.discountCents;
    const address = order.deliveryAddress;
    // One line for the doorbell, and the thing the maps app is handed.
    const addressLine = address
      ? [address.street, address.zip, address.city].filter(Boolean).join(", ")
      : "";
    const cardNote = note && note.id === order.id ? note : null;

    return (
      <View
        key={order.id}
        style={[styles.card, closed && styles.cardClosed, lit && styles.cardFresh]}
      >
        <View style={styles.headRow}>
          <Text style={styles.number}>#{String(order.orderNumber).padStart(4, "0")}</Text>
          <View style={[styles.pill, closed ? styles.pillDone : styles.pillActive]}>
            <Text
              style={[styles.pillText, closed ? styles.pillTextDone : styles.pillTextActive]}
              numberOfLines={1}
            >
              {statusShort[order.status] ?? order.status}
            </Text>
          </View>
          <View style={[styles.pill, pay.settled ? styles.pillDone : styles.pillNeutral]}>
            <Text style={styles.pillIcon}>{pay.icon}</Text>
            <Text
              style={[styles.pillText, pay.settled ? styles.pillTextDone : styles.pillTextNeutral]}
              numberOfLines={1}
            >
              {pay.text}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {TYPE_ICONS[order.orderType] ?? "•"} {typeText}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {placed}
            {planned ? ` · ${fill(t.boardPlanned, { time: planned })}` : ""}
          </Text>
        </View>

        <View style={styles.items}>
          {order.items.map((item, index) => (
            <View key={`${order.id}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemQty}>{item.quantity}×</Text>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>
                {money(item.priceCents * item.quantity, order.currency)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t.total}</Text>
          <Text style={styles.total}>{money(order.totalCents, order.currency)}</Text>
        </View>
        {discountCents > 0 ? (
          <Text style={styles.rewardOff}>
            {fill(t.ordersRewardOff, { value: money(discountCents, order.currency) })}
          </Text>
        ) : null}

        {order.customerName || order.customerPhone || addressLine || address?.note ? (
          <View style={styles.contact}>
            {order.customerName ? (
              <Text style={styles.contactName}>{order.customerName}</Text>
            ) : null}
            <View style={styles.contactBtns}>
              {order.customerPhone ? (
                <Pressable
                  onPress={() => callPhone(order.customerPhone as string)}
                  style={styles.contactBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.boardCall} ${order.customerPhone}`}
                >
                  <Text style={styles.contactBtnText}>📞 {order.customerPhone}</Text>
                </Pressable>
              ) : null}
              {addressLine ? (
                <Pressable
                  onPress={() => openDirections(order)}
                  style={styles.contactBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.boardDirections}: ${addressLine}`}
                >
                  <Text style={styles.contactBtnText} numberOfLines={2}>
                    🧭 {addressLine}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {address?.note ? (
              <Text style={styles.contactNote}>
                {t.boardNote}: {address.note}
              </Text>
            ) : null}
          </View>
        ) : null}

        {order.allowedNext.length > 0 ? (
          <View style={styles.actions}>
            {order.allowedNext.map((to) => {
              const quiet = to === "cancelled" || to === "canceled";
              const busy = busyId === order.id;
              return (
                <Pressable
                  key={`${order.id}-${to}`}
                  onPress={() => void advance(order, to)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  style={({ pressed }) => [
                    styles.action,
                    quiet ? styles.actionQuiet : styles.actionPrimary,
                    (busy || pressed) && { opacity: 0.6 },
                  ]}
                >
                  <Text style={quiet ? styles.actionQuietText : styles.actionPrimaryText}>
                    {statusShort[to] ?? to}
                  </Text>
                </Pressable>
              );
            })}
            {busyId === order.id ? <ActivityIndicator color={colors.red} /> : null}
          </View>
        ) : null}

        {cardNote ? (
          <Text style={styles.cardNote}>
            {cardNote.kind === "moved" ? t.boardMoved : t.boardActionFailed}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.boardTitle} />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.red} />
        }
      >
        {offline ? <Text style={styles.offline}>{t.boardReconnecting}</Text> : null}

        <Text style={styles.section}>
          {t.boardOpen}
          {open.length > 0 ? ` · ${open.length}` : ""}
        </Text>
        {open.length === 0 ? (
          loaded ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t.boardEmpty}</Text>
              <Text style={styles.emptySub}>{t.boardEmptySub}</Text>
            </View>
          ) : (
            <ActivityIndicator color={colors.red} style={{ marginVertical: 24 }} />
          )
        ) : (
          open.map((order) => renderCard(order, false))
        )}

        {doneToday.length > 0 ? (
          <>
            <Text style={[styles.section, { marginTop: 10 }]}>
              {t.boardDone} · {doneToday.length}
            </Text>
            {doneToday.map((order) => renderCard(order, true))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  offline: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 12.5,
    textAlign: "center",
  },
  section: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11.5,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  empty: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 34,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: { color: colors.ink, fontSize: 16, ...fonts.bodyBold },
  emptySub: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  /** Finished: still legible, no longer competing for attention. */
  cardClosed: { backgroundColor: colors.cream, opacity: 0.75 },
  /** Just arrived: the gold the brand uses for "look here". */
  cardFresh: { borderColor: colors.goldSoft, borderWidth: 2, backgroundColor: "#fdf6e3" },
  headRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  number: { color: colors.ink, fontSize: 19, ...fonts.bodyHeavy },
  metaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  meta: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5, flexShrink: 1 },
  items: { gap: 3, borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 },
  itemRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  itemQty: { color: colors.red, ...fonts.bodyHeavy, fontSize: 14, minWidth: 26 },
  itemName: { color: colors.ink, ...fonts.bodySemi, fontSize: 14.5, flex: 1 },
  itemPrice: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 8,
  },
  totalLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13 },
  total: { color: colors.red, fontSize: 17, ...fonts.bodyHeavy },
  rewardOff: { color: colors.gold, ...fonts.bodySemi, fontSize: 11.5 },
  contact: {
    gap: 6,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 8,
  },
  contactName: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  contactBtns: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  contactBtn: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexShrink: 1,
  },
  contactBtnText: { color: colors.ink, ...fonts.bodySemi, fontSize: 13 },
  contactNote: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 },
  action: {
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderWidth: 1.5,
    minWidth: 96,
    alignItems: "center",
  },
  actionPrimary: { backgroundColor: colors.red, borderColor: colors.red },
  actionPrimaryText: { color: colors.onRed, ...fonts.bodyHeavy, fontSize: 14 },
  actionQuiet: { backgroundColor: colors.creamCard, borderColor: colors.line },
  actionQuietText: { color: colors.inkSoft, ...fonts.bodyBold, fontSize: 14 },
  cardNote: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 3,
    paddingStart: 7,
    paddingEnd: 9,
  },
  pillIcon: { fontSize: 11, lineHeight: 14 },
  pillText: { fontSize: 11.5, ...fonts.bodyBold },
  pillActive: { backgroundColor: "#fdeee6", borderColor: colors.red },
  pillTextActive: { color: colors.red },
  pillDone: { backgroundColor: "#e9f3e4", borderColor: "#3f7030" },
  pillTextDone: { color: "#3f7030" },
  pillNeutral: { backgroundColor: colors.cream, borderColor: colors.line },
  pillTextNeutral: { color: colors.inkSoft },
});
