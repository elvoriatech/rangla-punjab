import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import { useAuth } from "../auth";
import type { StaffOrder } from "../staff";
import {
  advanceStaffOrder,
  fetchStaffIssues,
  fetchStaffOrders,
  isClosedStatus,
  isOpenIssue,
} from "../staff";
import { BrandHeader } from "../components";
import { IssueSheet } from "../issue-sheet";
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

/**
 * The status each action MOVES the order to, as a glyph. The buttons are
 * icon-first so a card's actions cost one line instead of three — the
 * translated label stays as the caption underneath and as the
 * accessibility label, because a flame alone is not a verb.
 *
 * A status this build has never heard of still gets a button (the server
 * owns the lifecycle): a plain forward arrow, captioned with whatever the
 * server calls it.
 */
const ACTION_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  preparing: "flame-outline",
  ready: "checkmark-circle-outline",
  out_for_delivery: "bicycle-outline",
  done: "checkmark-done-outline",
  // Not in the brief's list, but an arrow on "Cancel" would point the
  // wrong way at the one action nobody may mis-tap.
  cancelled: "close-circle-outline",
  canceled: "close-circle-outline",
};

const METHOD_ICONS: Record<string, string> = {
  card: "💳",
  stripe: "💳",
  paypal: "🅿️",
  cash: "💶",
  voucher: "🎁",
};

/** The out-of-band, terminal transition (P7-17). Spelled two ways
 *  because the server's own vocabulary is what the board renders, and an
 *  older deployment may still say "canceled". */
function isCancelTransition(to: string): boolean {
  return to === "cancelled" || to === "canceled";
}

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

export function BoardScreen({
  refreshKey = 0,
  onOpenOwnerMenu,
}: {
  /** Changes when something OUTSIDE this screen knows the board is stale
   *  — today that is a push landing while the app is open (P7-11). The
   *  value itself means nothing; only that it changed. */
  refreshKey?: number;
  /** The header's burger — the board is a restaurant-only screen, so it
   *  is always there in practice; optional so the type doesn't lie. */
  onOpenOwnerMenu?: () => void;
} = {}): React.ReactElement {
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
  /** Which cards are open. A card is a headline until someone asks for the
   *  rest of it — the board is a list to scan, not a wall to scroll. Nothing
   *  is persisted: closing the app gives the quiet default back. */
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** The complaint thread the counter opened from a card's pill. The
   *  board only knows an order HAS one, so the id is looked up on tap. */
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueBusy, setIssueBusy] = useState(false);

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
        // A ticket that just landed opens itself: the kitchen should read
        // the items without being asked to tap first.
        setExpandedIds((prev) => {
          const next = new Set(prev);
          for (const id of arrived) next.add(id);
          return next;
        });
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

  // A push arrived while the app was open: re-read the whole board at
  // once rather than waiting out the rest of the poll interval. Skipped
  // on the first render — the effect above has just done a full read.
  const firstRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstRefreshKey.current) return;
    firstRefreshKey.current = refreshKey;
    void loadRef.current("full");
  }, [refreshKey]);

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

  const toggleCard = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load("full").finally(() => setRefreshing(false));
  }, [load]);

  /**
   * Cancelling is the one action on this board that cannot be walked
   * back, so it asks first — once, on the transition itself rather than
   * on the button, so every route to it (an unknown-but-cancelling
   * status the server grows later included) is guarded.
   */
  function onAction(order: StaffOrder, to: string): void {
    if (!isCancelTransition(to)) {
      void advance(order, to);
      return;
    }
    Alert.alert(t.boardCancelTitle, t.boardCancelBody, [
      { text: t.boardCancelKeep, style: "cancel" },
      {
        text: t.boardCancelConfirm,
        style: "destructive",
        onPress: () => void advance(order, to),
      },
    ]);
  }

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

  /**
   * Open the complaint on this order. The board's payload normally names
   * the thread outright; a server that predates `issueId` sends only the
   * status, and the id is then found by matching the complaints list on
   * the order (resolved included — a settled complaint is still readable).
   */
  async function openIssue(order: StaffOrder): Promise<void> {
    if (!staffToken || issueBusy) return;
    if (order.issueId) {
      setIssueId(order.issueId);
      return;
    }
    setIssueBusy(true);
    const res = await fetchStaffIssues(staffToken, true);
    setIssueBusy(false);
    if (!res.ok) {
      if (res.error === "unauthorized") clearStaff();
      else say(order.id, "failed");
      return;
    }
    const match = res.data.find((issue) => issue.orderId === order.id);
    if (!match) {
      // The board says there is one and the list disagrees: stale card.
      say(order.id, "failed");
      void load("full");
      return;
    }
    setIssueId(match.id);
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
  const issueStatusLabels = t.issueStatusLabels as Record<string, string>;

  const open = orders
    .filter((o) => !isClosedStatus(o.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const doneToday = orders
    .filter((o) => isClosedStatus(o.status) && isToday(o.updatedAt || o.createdAt))
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));

  function renderCard(order: StaffOrder, closed: boolean): React.ReactElement {
    const lit = fresh.includes(order.id);
    const expanded = expandedIds.has(order.id);
    const number = `#${String(order.orderNumber).padStart(4, "0")}`;
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
    const hasContact = Boolean(
      order.customerName || order.customerPhone || addressLine || address?.note,
    );
    const cardNote = note && note.id === order.id ? note : null;
    // P7-17 deliberately refunds nothing automatically — so the card has
    // to say out loud that money is still sitting with the provider.
    const refundOwed = isCancelTransition(order.status) && paid && !byReward;

    return (
      <View
        key={order.id}
        style={[styles.card, closed && styles.cardClosed, lit && styles.cardFresh]}
      >
        {/* The headline: everything the pass needs to triage at a glance,
            and the tap target that reveals the rest. */}
        <Pressable
          onPress={() => toggleCard(order.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={fill(t.boardOrderDetails, { number })}
          style={({ pressed }) => [styles.header, pressed && { opacity: 0.65 }]}
        >
          <View style={styles.headRow}>
            <View style={styles.headMain}>
              <Text style={styles.number}>{number}</Text>
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
                  style={[
                    styles.pillText,
                    pay.settled ? styles.pillTextDone : styles.pillTextNeutral,
                  ]}
                  numberOfLines={1}
                >
                  {pay.text}
                </Text>
              </View>
              {/* A guest is waiting on an answer. Tapping it opens the
                  thread rather than expanding the card — nested presses
                  resolve to the inner one. */}
              {isOpenIssue(order.issueStatus) ? (
                <Pressable
                  onPress={() => void openIssue(order)}
                  disabled={issueBusy}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.issuePill}: ${
                    issueStatusLabels[order.issueStatus ?? ""] ?? order.issueStatus ?? ""
                  }`}
                  style={({ pressed }) => [
                    styles.pill,
                    styles.pillProblem,
                    (pressed || issueBusy) && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.pillIcon}>⚠️</Text>
                  <Text style={[styles.pillText, styles.pillTextProblem]} numberOfLines={1}>
                    {t.issuePill} ·{" "}
                    {issueStatusLabels[order.issueStatus ?? ""] ?? order.issueStatus}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.headEnd}>
              <Text style={styles.total}>{money(order.totalCents, order.currency)}</Text>
              {/* Vertical glyph on purpose: it means the same thing in an
                  RTL layout, so there is nothing to mirror. */}
              <Text style={[styles.chevron, expanded && styles.chevronOpen]}>▾</Text>
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
        </Pressable>

        {expanded ? (
          <>
            {hasContact ? (
              <View style={styles.contact}>
                {order.customerName || order.customerPhone ? (
                  // Who it is, and the one tap that reaches them — opposite
                  // ends of the same line, so the eye finds both at once.
                  <View style={styles.contactTop}>
                    <Text style={styles.contactName} numberOfLines={1}>
                      {order.customerName ?? ""}
                    </Text>
                    {order.customerPhone ? (
                      <Pressable
                        onPress={() => callPhone(order.customerPhone as string)}
                        accessibilityRole="button"
                        accessibilityLabel={`${t.boardCall} ${order.customerPhone}`}
                        style={({ pressed }) => [styles.phoneBtn, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={styles.phoneBtnText} numberOfLines={1}>
                          📞 {order.customerPhone}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {addressLine ? (
                  // The address gets the full width it needs; the whole row
                  // is the directions button.
                  <Pressable
                    onPress={() => openDirections(order)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.boardDirections}: ${addressLine}`}
                    style={({ pressed }) => [styles.addressRow, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.address} numberOfLines={2}>
                      {addressLine}
                    </Text>
                    <View style={styles.dirChip}>
                      <Text style={styles.dirChipText} numberOfLines={1}>
                        🧭 {t.boardDirections}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}

                {address?.note ? (
                  <Text style={styles.contactNote}>
                    {t.boardNote}: {address.note}
                  </Text>
                ) : null}
              </View>
            ) : null}

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

            {discountCents > 0 ? (
              <Text style={styles.rewardOff}>
                {fill(t.ordersRewardOff, { value: money(discountCents, order.currency) })}
              </Text>
            ) : null}

            {order.allowedNext.length > 0 ? (
              <View style={styles.actions}>
                {busyId === order.id ? <ActivityIndicator color={colors.red} /> : null}
                {order.allowedNext.map((to, index) => {
                  // Cancelling is destructive, not merely secondary: it
                  // wears the danger colour so a mis-tap is a visibly
                  // different button, never a quieter version of "next".
                  const destructive = isCancelTransition(to);
                  // The first step that isn't a cancel is the one the pass
                  // will actually tap — it gets the filled button.
                  const primary =
                    !destructive &&
                    index === order.allowedNext.findIndex((x) => !isCancelTransition(x));
                  const busy = busyId === order.id;
                  const label = statusShort[to] ?? to;
                  return (
                    <Pressable
                      key={`${order.id}-${to}`}
                      onPress={() => onAction(order, to)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ disabled: busy }}
                      style={({ pressed }) => [
                        styles.action,
                        (busy || pressed) && { opacity: 0.6 },
                      ]}
                    >
                      <View
                        style={[
                          styles.actionIcon,
                          primary
                            ? styles.actionIconPrimary
                            : destructive
                              ? styles.actionIconDanger
                              : styles.actionIconOutline,
                        ]}
                      >
                        <Ionicons
                          name={ACTION_ICONS[to] ?? "arrow-forward-outline"}
                          size={20}
                          color={primary ? colors.onRed : destructive ? colors.danger : colors.red}
                        />
                      </View>
                      <Text
                        style={[styles.actionCaption, destructive && styles.actionCaptionDanger]}
                        numberOfLines={2}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : null}

        {refundOwed ? <Text style={styles.refundNote}>{t.boardCancelledPaid}</Text> : null}

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
      <BrandHeader title={t.boardTitle} onMenu={onOpenOwnerMenu} />
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

      <IssueSheet
        target={issueId && staffToken ? { mode: "staff", token: staffToken, issueId } : null}
        onClose={() => setIssueId(null)}
        // Replying or resolving changes the card's pill: re-read the
        // board rather than patching one order in place.
        onChanged={() => void load("full")}
      />
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
  header: { gap: 6 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headMain: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 },
  headEnd: { flexDirection: "row", alignItems: "center", gap: 8 },
  chevron: { color: colors.inkSoft, fontSize: 15, lineHeight: 18, ...fonts.bodyHeavy },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
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
  total: { color: colors.red, fontSize: 17, ...fonts.bodyHeavy },
  rewardOff: { color: colors.gold, ...fonts.bodySemi, fontSize: 11.5 },
  contact: {
    gap: 6,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 8,
  },
  contactTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  contactName: { color: colors.ink, ...fonts.bodyBold, fontSize: 14, flex: 1 },
  phoneBtn: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexShrink: 1,
  },
  phoneBtnText: { color: colors.ink, ...fonts.bodySemi, fontSize: 13 },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    paddingStart: 12,
    paddingEnd: 8,
    paddingVertical: 8,
  },
  address: { color: colors.ink, ...fonts.bodySemi, fontSize: 13, flex: 1 },
  dirChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.creamCard,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dirChipText: { color: colors.ink, ...fonts.bodyBold, fontSize: 12.5 },
  contactNote: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  // Compact, icon-first, and pushed to the END of the card: the actions
  // are a tool rail, not a row of slabs competing with the order itself.
  actions: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 2,
  },
  action: { alignItems: "center", gap: 3, width: 62 },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconPrimary: { backgroundColor: colors.red, borderColor: colors.red },
  actionIconOutline: { backgroundColor: colors.creamCard, borderColor: colors.red },
  actionIconDanger: { backgroundColor: colors.creamCard, borderColor: colors.danger },
  actionCaption: { color: colors.red, ...fonts.bodyBold, fontSize: 10, textAlign: "center" },
  actionCaptionDanger: { color: colors.danger },
  cardNote: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  // Money the venue still owes a guest: loud enough to be acted on, and
  // it stays on the card for as long as the cancelled order is listed.
  refundNote: {
    color: colors.danger,
    ...fonts.bodySemi,
    fontSize: 12,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 8,
  },
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
  // A complaint waiting on the restaurant — the one pill on the card
  // that is an action, not a state.
  pillProblem: { backgroundColor: "#fdeee6", borderColor: colors.danger },
  pillTextProblem: { color: colors.danger },
});
