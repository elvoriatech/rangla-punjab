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
  Switch,
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
import type { PrintOutcome } from "../print";
import {
  baselinePrinted,
  claimUnprinted,
  isAutoPrintOn,
  printTicket,
  setAutoPrintOn,
} from "../print";
import type { Chime } from "../sound";
import { isNewOrderSoundOn, loadChime, setNewOrderSoundOn } from "../sound";
import { useLayout } from "../layout";
import { venueTimezone } from "../hours";
import { colors, fonts, money, radius } from "../theme";
import { fill, localeTag, useI18n } from "../i18n";

/**
 * The restaurant's board — every live order, in one screen the counter
 * can read from arm's length.
 *
 * Rules it lives by:
 *
 *  - The SERVER owns the lifecycle. A card carries exactly ONE status
 *    button: the next step of `allowedNext`, so a venue that grows "out
 *    for delivery" (or drops it) needs no release here. Cancelling is
 *    not a step in that chain — it shares the opened card's last line
 *    with printing as a quiet text action, never as a second button
 *    beside the one the pass taps.
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
 * The status the card's button MOVES the order to, as a glyph. The
 * button is icon-first so the action costs one line instead of three —
 * the translated label stays as the caption underneath and as the
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

/**
 * The lifecycle in reading order. It is NOT the app deciding what may
 * happen — the server's `allowedNext` still is — only which of the steps
 * it offers comes first, so the card can carry one button instead of a
 * rack of them. A step this build has never heard of keeps its turn in
 * the order the server sent it.
 */
const ADVANCE_CHAIN = ["preparing", "ready", "out_for_delivery", "done"] as const;

/** The single status a card's button advances to, or null when the order
 *  can only be cancelled from here (or moves nowhere at all). */
function nextStatusOf(allowedNext: readonly string[]): string | null {
  const forward = allowedNext.filter((to) => !isCancelTransition(to));
  for (const step of ADVANCE_CHAIN) {
    if (forward.includes(step)) return step;
  }
  return forward[0] ?? null;
}

/**
 * A pre-order whose slot has not come round yet. Deliberately computed
 * on every render rather than stored: the board re-renders on each poll,
 * so the card's "scheduled" treatment drops by itself the moment the
 * requested time passes, with nothing to invalidate.
 */
function isScheduled(requestedFor: string | null): boolean {
  if (!requestedFor) return false;
  const at = new Date(requestedFor).getTime();
  return Number.isFinite(at) && at > Date.now();
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
  // Two columns on a tablet, three on a big one, one on a phone — and it
  // follows a rotation without anything having to be invalidated.
  const layout = useLayout();

  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Per-order footnote: the order moved on without us, or the request
   *  simply failed. Said once, then it gets out of the way. */
  const [note, setNote] = useState<{
    id: string;
    kind: "moved" | "failed" | "cancelDisabled";
  } | null>(null);
  const [fresh, setFresh] = useState<readonly string[]>([]);
  /** Which cards are open. A card is a headline until someone asks for the
   *  rest of it — the board is a list to scan, not a wall to scroll. Nothing
   *  is persisted: closing the app gives the quiet default back. */
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** The complaint thread the counter opened from a card's pill. The
   *  board only knows an order HAS one, so the id is looked up on tap. */
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueBusy, setIssueBusy] = useState(false);
  /** Which card's ticket is on its way to a printer, so its action can
   *  say so instead of looking like it did nothing. */
  const [printingId, setPrintingId] = useState<string | null>(null);
  /**
   * Whether new orders print themselves. Held in state AND in a ref: the
   * switch renders from the state, but the poll — which is closed over
   * by an interval that must not be torn down and rebuilt every time the
   * owner flips it — reads the ref.
   */
  const [autoPrint, setAutoPrint] = useState(false);
  const autoPrintRef = useRef(false);
  autoPrintRef.current = autoPrint;
  /**
   * Whether a new order makes a noise. Held the same two ways and for
   * the same reason as the printer switch above — and defaulted ON,
   * because unlike a printer a chime has nothing to go wrong and an
   * order nobody noticed is the failure this board exists to prevent.
   */
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  soundRef.current = sound;
  /** Printing talks back in one line above the board rather than on a
   *  card: an auto-print run can cover several orders at once. */
  const [toast, setToast] = useState<string | null>(null);

  /** Server clock from the last successful read — the `since` cursor. */
  const sinceRef = useRef<string | null>(null);
  /** Every order id this session has ever seen. Null until the first
   *  read lands, so a cold start doesn't buzz for the whole board. */
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /**
   * The auto-print runner, reached through a ref.
   *
   * `load` is the poll's callback and is deliberately free of print
   * state — rebuilding it every time the owner flips the switch would
   * tear down and restart the polling interval mid-service. So the poll
   * calls through this ref, which the effect below keeps current.
   */
  const autoPrintRunRef = useRef<(ids: readonly string[]) => void>(() => {});
  /** The loaded chime, for the poll to reach without re-rendering it
   *  into existence. Null until the board has mounted, and again after
   *  it unmounts — both are silence, which is the safe direction. */
  const chimeRef = useRef<Chime | null>(null);

  const tag = localeTag(lang);
  /**
   * Every clock on this board, in the VENUE's zone.
   *
   * `hours.ts` makes the rule explicit: the device's own timezone is
   * never the venue's, and a tablet that has travelled (or a phone with
   * a stale zone) would otherwise put "placed 17:06" and "on the way
   * since 17:06" on two different clocks from the printed ticket and the
   * guest's tracker. `venueTimezone()` falls back to the zone baked into
   * the build, and to `undefined` when even that is unset — which is
   * exactly the device-local behaviour this had before.
   */
  const zone = venueTimezone() ?? undefined;
  const timeOf = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      if (!iso || Number.isNaN(d.getTime())) return "";
      return d.toLocaleTimeString(tag, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
      });
    },
    [tag, zone],
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
        // Same detection that lights the card gold and buzzes the phone
        // drives the printer: one ticket per order, the moment it lands.
        if (autoPrintRef.current) autoPrintRunRef.current(arrived);
        // One short buzz, not a ringtone: the kitchen is a quiet room.
        Vibration.vibrate(250);
        // ONE chime per poll, however many orders it carried: four
        // tickets landing together are one piece of news, and four
        // overlapping dings are just noise. `seen` is null until the
        // first read lands, so `arrived` is empty on a cold start and
        // the board never announces its own backlog.
        if (soundRef.current) chimeRef.current?.play();
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

  // The switch survives a restart; what it printed does too (see
  // `print.ts`), so a relaunch mid-service picks up where it left off.
  useEffect(() => {
    let alive = true;
    void isAutoPrintOn().then((on) => {
      if (alive) setAutoPrint(on);
    });
    void isNewOrderSoundOn().then((on) => {
      if (alive) setSound(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The chime is loaded the moment the board opens, not the moment an
   * order lands: decoding the file costs longer than the gap the kitchen
   * would hear between the card lighting up and the ding.
   *
   * It is loaded even when the switch is off — flipping it on mid-rush
   * must be instant, and a silent player costs one decoded second and a
   * half of audio. The staff session gates it so nothing but a
   * restaurant device ever opens an audio route; a guest never reaches
   * this screen at all.
   */
  useEffect(() => {
    if (!staffToken) return;
    const chime = loadChime();
    chimeRef.current = chime;
    return () => {
      chimeRef.current = null;
      chime.release();
    };
  }, [staffToken]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
    },
    [],
  );

  /** The footnotes are news, not state — they fade on their own. */
  const say = useCallback((id: string, kind: "moved" | "failed" | "cancelDisabled") => {
    setNote({ id, kind });
    const timer = setTimeout(() => {
      timersRef.current = timersRef.current.filter((x) => x !== timer);
      setNote((current) =>
        current && current.id === id && current.kind === kind ? null : current,
      );
    }, 6_000);
    timersRef.current.push(timer);
  }, []);

  /** News, not state — it fades on its own, like the per-card notes. */
  const announce = useCallback((text: string) => {
    setToast(text);
    const timer = setTimeout(() => {
      timersRef.current = timersRef.current.filter((x) => x !== timer);
      setToast((current) => (current === text ? null : current));
    }, 6_000);
    timersRef.current.push(timer);
  }, []);

  /** One sentence per way printing can end. A cancelled print sheet is
   *  the owner changing their mind, so it says nothing at all. */
  const sayPrint = useCallback(
    (outcome: PrintOutcome): void => {
      if (outcome === "ok" || outcome === "cancelled") return;
      if (outcome === "unauthorized") {
        clearStaff();
        return;
      }
      announce(outcome === "network" ? t.boardPrintOffline : t.boardPrintFailed);
    },
    [announce, clearStaff, t],
  );

  const printOne = useCallback(
    async (order: StaffOrder): Promise<void> => {
      if (!staffToken || printingId) return;
      setPrintingId(order.id);
      announce(t.boardPrinting);
      const outcome = await printTicket(staffToken, order.id);
      setPrintingId(null);
      if (outcome === "ok") {
        announce(t.boardPrinted);
        return;
      }
      sayPrint(outcome);
    },
    [staffToken, printingId, announce, sayPrint, t],
  );

  /**
   * Print the tickets for orders the poll just called new.
   *
   * `claimUnprinted` is what makes "once" true across restarts: the ids
   * are recorded before the paper comes out, so a relaunch mid-service
   * never re-spools the backlog. Failures are announced and then let go
   * — the board is what the kitchen is actually working from, and a
   * printer nobody plugged in must not stop it updating.
   */
  const runAutoPrint = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (!staffToken) return;
      const fresh = await claimUnprinted(ids);
      if (fresh.length === 0) return;
      let failure: PrintOutcome | null = null;
      for (const id of fresh) {
        const outcome = await printTicket(staffToken, id);
        // One line however many tickets failed: a kitchen does not need
        // the same sentence four times.
        if (outcome !== "ok" && outcome !== "cancelled" && !failure) failure = outcome;
      }
      if (failure) sayPrint(failure);
    },
    [staffToken, sayPrint],
  );
  autoPrintRunRef.current = (ids) => void runAutoPrint(ids);

  /**
   * Flipping the switch on does NOT print what is already there. The
   * open board at that moment is work in progress, not news, so it is
   * baselined — recorded as printed without printing — and only what
   * arrives afterwards reaches the printer.
   */
  const toggleAutoPrint = useCallback(
    (next: boolean): void => {
      setAutoPrint(next);
      void setAutoPrintOn(next);
      if (!next) return;
      void baselinePrinted(orders.filter((o) => !isClosedStatus(o.status)).map((o) => o.id));
    },
    [orders],
  );

  /**
   * The sound switch has no backlog problem to solve — it changes what
   * the NEXT arrival does and nothing else — so unlike the printer it
   * baselines nothing. Turning it on previews nothing either: the pass
   * is a shared room, and a switch that dings every time someone brushes
   * it is a switch that gets turned off for good.
   */
  const toggleSound = useCallback((next: boolean): void => {
    setSound(next);
    void setNewOrderSoundOn(next);
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
      // A 409 is two different things. `cancel_disabled` is the venue's
      // own setting — the dashboard switch is off — so re-reading the
      // board would change nothing and "someone moved it" would be
      // wrong. Anything else IS a stale board.
      if (res.reason === "cancel_disabled") {
        say(order.id, "cancelDisabled");
        return;
      }
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

  /**
   * One column is a plain stack; two or three wrap. `alignItems:
   * flex-start` keeps each card its own height — a row of cards
   * stretched to match the tallest one would put an order's action
   * button half a screen below its items.
   */
  const gridStyle = layout.wide
    ? {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "flex-start" as const,
        gap: layout.gap,
      }
    : { gap: layout.gap };

  /**
   * The card's own width, whatever the column count — and the one point
   * below which the foot row stops being a row: a step button plus two
   * text actions need roughly 300 pt of card to sit side by side, so
   * under that the button takes the line and the text actions wrap.
   */
  const cardOuter = layout.cardWidth ?? layout.width - 2 * layout.pad;
  const tightFoot = cardOuter < 300;

  function renderCard(order: StaffOrder, closed: boolean): React.ReactElement {
    const lit = fresh.includes(order.id);
    const expanded = expandedIds.has(order.id);
    const number = `#${String(order.orderNumber).padStart(4, "0")}`;
    const placed = timeOf(order.createdAt);
    /**
     * When the food actually left, on a delivery that is still out.
     *
     * Only while the status IS `out_for_delivery`: a delivered order
     * still carries the timestamp, and "on the way since 17:06" on an
     * order that arrived at 17:20 would be a lie the counter has to
     * re-read twice. Written by whichever route moved it — this board's
     * own button, the ticket QR, or the staff app's dispatch screen —
     * so the line appears the same way for all three.
     */
    const onTheWay =
      order.status === "out_for_delivery" && order.outForDeliveryAt
        ? timeOf(order.outForDeliveryAt)
        : "";
    const planned = order.requestedFor ? timeOf(order.requestedFor) : "";
    // Due later, not now: a calmer card, re-judged on every poll.
    const scheduled = isScheduled(order.requestedFor);
    // One step forward, and — separately — the way out of the lifecycle.
    const nextTo = nextStatusOf(order.allowedNext);
    const cancelTo = order.allowedNext.find((to) => isCancelTransition(to)) ?? null;
    // One transition at a time per card, whichever route asked for it.
    const busy = busyId === order.id;
    const printing = printingId === order.id;
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
    // Shown even when the reward covered the whole bill: the pill says a
    // reward paid, this says how much it was worth and what it cost the
    // guest in points — which is what the counter is asked about.
    const discountCents = order.discountCents;
    const discountPoints = order.discountPoints;
    // A sibling of the reward line, not an alternative: an order can
    // carry both, and the counter needs to see why the total is small.
    const giftCardCents = order.giftCardDiscountCents;
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
        style={[
          styles.card,
          // One column: the card fills the row. Two or three: an exact
          // width, because `gap` and percentage widths overflow.
          layout.cardWidth ? { width: layout.cardWidth } : null,
          closed && styles.cardClosed,
          scheduled && styles.cardScheduled,
          lit && styles.cardFresh,
        ]}
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
              {planned ? (
                // Nested so only the slot itself carries the colour: the
                // time it was PLACED is not the news on a pre-order.
                <Text style={scheduled ? styles.metaPlanned : undefined}>
                  {` · ${fill(t.boardPlanned, { time: planned })}`}
                </Text>
              ) : null}
            </Text>
          </View>

          {onTheWay ? (
            <Text style={styles.onTheWay} numberOfLines={1}>
              🛵 {fill(t.boardOnTheWaySince, { time: onTheWay })}
            </Text>
          ) : null}
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
                {fill(discountPoints > 0 ? t.ordersRewardOffPoints : t.ordersRewardOff, {
                  value: money(discountCents, order.currency),
                  points: discountPoints,
                })}
              </Text>
            ) : null}

            {giftCardCents > 0 ? (
              <Text style={styles.rewardOff}>
                {fill(t.ordersGiftCardOff, { value: money(giftCardCents, order.currency) })}
                {order.giftCardLast4 ? ` · ····${order.giftCardLast4}` : ""}
              </Text>
            ) : null}

            {/* The foot of the opened card, on ONE line: the single step
                button on the reading edge taking whatever width is left,
                then printing and cancelling as compact text actions on
                the far edge. Neither of those is the next step, so
                neither is a button — and cancelling keeps its own
                confirm. `row` + start/end padding mirror themselves in
                an RTL layout, so there is nothing to flip by hand. */}
            <View style={[styles.footRow, tightFoot && styles.footRowWrap]}>
              {nextTo ? (
                <Pressable
                  onPress={() => onAction(order, nextTo)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={statusShort[nextTo] ?? nextTo}
                  accessibilityState={{ disabled: busy }}
                  style={({ pressed }) => [
                    styles.stepAction,
                    // Narrow card: the step button keeps the whole first
                    // line and the text actions wrap under it.
                    tightFoot && styles.stepActionWide,
                    (busy || pressed) && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons
                    name={ACTION_ICONS[nextTo] ?? "arrow-forward-outline"}
                    size={18}
                    color={colors.onRed}
                  />
                  <Text style={styles.stepActionText} numberOfLines={1}>
                    {statusShort[nextTo] ?? nextTo}
                  </Text>
                </Pressable>
              ) : null}
              {/* The spinner for whichever transition is in flight — a
                  cancel from this same row included. */}
              {busy ? <ActivityIndicator color={colors.red} /> : null}
              <Text
                onPress={printing ? undefined : () => void printOne(order)}
                suppressHighlighting
                accessibilityRole="button"
                accessibilityLabel={fill(t.boardPrintTicket, { number })}
                accessibilityState={{ disabled: printing }}
                style={[styles.printAction, printing && { opacity: 0.5 }]}
                numberOfLines={1}
              >
                {`🖨 ${t.boardPrint}`}
              </Text>
              {cancelTo ? (
                <Text
                  onPress={busy ? undefined : () => onAction(order, cancelTo)}
                  suppressHighlighting
                  accessibilityRole="button"
                  accessibilityLabel={t.boardCancelAction}
                  accessibilityState={{ disabled: busy }}
                  style={[styles.cancelAction, busy && { opacity: 0.5 }]}
                  numberOfLines={2}
                >
                  {t.boardCancelAction}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}

        {refundOwed ? <Text style={styles.refundNote}>{t.boardCancelledPaid}</Text> : null}

        {cardNote ? (
          <Text style={styles.cardNote}>
            {cardNote.kind === "moved"
              ? t.boardMoved
              : cardNote.kind === "cancelDisabled"
                ? t.boardCancelDisabled
                : t.boardActionFailed}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.boardTitle} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{ padding: layout.pad, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.red} />
        }
      >
        {offline ? <Text style={styles.offline}>{t.boardReconnecting}</Text> : null}
        {toast ? <Text style={styles.toast}>{toast}</Text> : null}

        {/* The service switches sit above the board, not inside the
            owner menu: how a new order announces itself — on paper, out
            loud, or neither — is a decision the pass makes during
            service and has to be able to see the state of at a glance. */}
        <View style={styles.switchCard}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t.boardAutoPrint}</Text>
            <Switch
              value={autoPrint}
              onValueChange={toggleAutoPrint}
              accessibilityLabel={t.boardAutoPrint}
              trackColor={{ false: colors.line, true: colors.red }}
              thumbColor={colors.cream}
            />
          </View>
          {autoPrint ? <Text style={styles.switchHint}>{t.boardAutoPrintHint}</Text> : null}
          <View style={[styles.switchRow, styles.switchRowNext]}>
            <Text style={styles.switchLabel}>{t.boardSound}</Text>
            <Switch
              value={sound}
              onValueChange={toggleSound}
              accessibilityLabel={t.boardSound}
              trackColor={{ false: colors.line, true: colors.red }}
              thumbColor={colors.cream}
            />
          </View>
        </View>

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
          <View style={gridStyle}>{open.map((order) => renderCard(order, false))}</View>
        )}

        {doneToday.length > 0 ? (
          <>
            <Text style={[styles.section, { marginTop: 10 }]}>
              {t.boardDone} · {doneToday.length}
            </Text>
            <View style={gridStyle}>{doneToday.map((order) => renderCard(order, true))}</View>
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
  /** What printing just did. Same voice as the offline line: one
   *  centred sentence that gets out of the way by itself. */
  toast: { color: colors.red, ...fonts.bodySemi, fontSize: 12.5, textAlign: "center" },
  switchCard: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 2,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 44,
  },
  switchLabel: { flex: 1, color: colors.ink, ...fonts.bodyBold, fontSize: 14.5 },
  /** Two switches in one card read as one setting unless something
   *  separates them — a hairline, not a gap, so the card stays compact
   *  enough to sit above the board rather than in front of it. */
  switchRowNext: { borderTopWidth: 1, borderTopColor: colors.line },
  switchHint: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    lineHeight: 16,
    paddingBottom: 8,
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
  /**
   * Due later: the card keeps its place in the queue (the pass still
   * reads the board in the order things were taken) and says so in
   * colour instead — a cool bar down the reading edge and a tint no
   * other state on this screen wears. `borderStart` so it stays on the
   * reading edge in an RTL layout.
   */
  cardScheduled: {
    backgroundColor: colors.infoSoft,
    borderStartWidth: 4,
    borderStartColor: colors.info,
  },
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
  /** The slot a pre-order is due in — the one fact that makes the card
   *  different, so it carries the card's own colour and weight. */
  metaPlanned: { color: colors.info, ...fonts.bodyBold },
  /** "🛵 Unterwegs seit 17:06" — brand red, because on this board red
   *  means live: this order is out there right now. */
  onTheWay: { color: colors.red, ...fonts.bodyBold, fontSize: 12.5, marginTop: 4 },
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
  /**
   * The opened card's last line: step button, print, cancel — one row.
   * `justifyContent: flex-end` is what keeps print and cancel on the far
   * edge on a closed order, where there is no step button to grow into
   * the space. Wrapping is opt-in (`footRowWrap`) rather than automatic,
   * so a tablet column never breaks the line by accident.
   */
  footRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 2,
  },
  footRowWrap: { flexWrap: "wrap" },
  /**
   * The one step this card offers: icon + label on a single 44 pt pill
   * that starts at the reading edge and eats the leftover width, so it
   * stays the obvious target without becoming a slab.
   */
  stepAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexGrow: 1,
    flexShrink: 1,
    // Enough for the longest short status in any locale; below this the
    // text actions give ground instead.
    minWidth: 104,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.red,
  },
  /** Narrow card: the button owns the first line on its own. */
  stepActionWide: { flexBasis: "100%" },
  stepActionText: { color: colors.onRed, ...fonts.bodyBold, fontSize: 13, flexShrink: 1 },
  // 20 pt of line plus 12 pt above and below is exactly the 44 pt floor
  // WCAG 2.5.5 asks for, with no box drawn around it.
  printAction: {
    color: colors.ink,
    ...fonts.bodyBold,
    fontSize: 12.5,
    lineHeight: 20,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  // Reachable, never prominent: no border, no fill, nothing that reads
  // as a second button — but a real target, not a 12px trap.
  cancelAction: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 12.5,
    lineHeight: 20,
    textDecorationLine: "underline",
    flexShrink: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
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
