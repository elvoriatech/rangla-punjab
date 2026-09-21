import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ExpoLinking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import {
  useFonts,
  Nunito_300Light,
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_800ExtraBold_Italic,
} from "@expo-google-fonts/nunito";
// The naskh face behind the halal mark's حلال. Loaded on EVERY build, not
// just the Arabic one: the mark is the venue's calligraphy, not a
// translation, so a German guest sees the same glyph (see `HalalMark`).
import { Amiri_700Bold } from "@expo-google-fonts/amiri";
import type { ApiMenu, ApiItem, OrderType, PlacedOrder } from "./src/api";
import { fetchMenu, OFFERS_CATEGORY_ID } from "./src/api";
import { CartProvider, useCart } from "./src/cart";
import { AuthProvider, useAuth } from "./src/auth";
import { I18nProvider, toLang, useI18n, type Lang } from "./src/i18n";
import { listStoredOrders, type StoredOrder } from "./src/orders-store";
import type { PushTarget } from "./src/push";
import { registerForStaffPush, usePushRouting } from "./src/push";
import { fetchStaffSummary } from "./src/staff";
import { useBumpOnChange } from "./src/motion";
import { openInAppBrowser, walletsFromAccepted } from "./src/payments";
import { colors, fonts } from "./src/theme";
import { TAB_BAR_MAX } from "./src/layout";
import { HomeScreen } from "./src/screens/HomeScreen";
import { MenuScreen } from "./src/screens/MenuScreen";
import { CartScreen } from "./src/screens/CartScreen";
import { OrdersScreen } from "./src/screens/OrdersScreen";
import { TrackScreen } from "./src/screens/TrackScreen";
import { AccountScreen } from "./src/screens/AccountScreen";
import { BoardScreen } from "./src/screens/BoardScreen";
import { LoyaltyStaffScreen } from "./src/screens/LoyaltyStaffScreen";
import { IssuesScreen } from "./src/screens/IssuesScreen";
import { RatingOwnerScreen } from "./src/screens/RatingOwnerScreen";
import { HoursOwnerScreen } from "./src/screens/HoursOwnerScreen";
import { ContactOwnerScreen } from "./src/screens/ContactOwnerScreen";
import { GiftCardsScreen } from "./src/screens/GiftCardsScreen";
import { MyGiftCardsScreen } from "./src/screens/MyGiftCardsScreen";
import { RedeemGiftCardScreen } from "./src/screens/RedeemGiftCardScreen";
import { GiftCardsOwnerScreen } from "./src/screens/GiftCardsOwnerScreen";
import { DispatchScreen } from "./src/screens/DispatchScreen";
import { WelcomeScreen } from "./src/screens/WelcomeScreen";
import { OwnerMenuSheet } from "./src/owner-menu";
import { PasswordSheet } from "./src/password-sheet";
import { OutlineButton } from "./src/components";

/**
 * Rangla Punjab — the single-restaurant app. One hand-rolled tab shell
 * (no navigation library: five tabs and one detail view don't earn a
 * dependency), the mockup's red/cream/gold identity throughout.
 *
 * The SAME app serves two people. A guest orders without an account (the
 * receipt tokens this device holds are the entire history). The owner
 * signs in on the ordinary Account form, the server answers with a staff
 * session, and the shell switches to **restaurant mode**: the live orders
 * board replaces Cart and Orders, and nothing guest-only (basket,
 * rewards, Google sign-in) is reachable. One device is one or the other,
 * never both — `auth.staff` is the whole switch.
 */

/** "loyalty", "issues", "rating", "hours", "contact" and the four
 *  gift-card views have no tab button: the guest ones are reached from
 *  Home and Account, the restaurant ones from the owner's burger, and
 *  each carries its own back arrow like the tracking view. */
type Tab =
  | "home"
  | "menu"
  | "cart"
  | "orders"
  | "board"
  | "loyalty"
  | "issues"
  | "rating"
  | "hours"
  | "contact"
  /** Guest: the shop window. */
  | "giftcards"
  /** Guest: the cards this account has bought. */
  | "mygiftcards"
  /** Restaurant: take a card at the counter. */
  | "redeemgift"
  /** Restaurant: the venue's gift-card book. */
  | "giftcardsowner"
  /** Restaurant: "out for delivery", opened by a delivery ticket's QR. */
  | "dispatch"
  | "info";

/** The owner-only views, which a guest device must never be left on. */
const OWNER_ONLY: readonly Tab[] = [
  "board",
  "loyalty",
  "issues",
  "rating",
  "hours",
  "contact",
  "redeemgift",
  "giftcardsowner",
  "dispatch",
];

/** How stale the menu may get while the app is in front. Five minutes is
 *  the edge payload's own stale-while-revalidate window — beyond that the
 *  open/closed pill and today's slots are guesses. */
const ACTIVE_REFRESH_MS = 5 * 60_000;
/** A return to the foreground this soon after the last read is a glance,
 *  not an absence — don't spend a request on it. */
const FOREGROUND_DEBOUNCE_MS = 10_000;
interface TrackTarget {
  orderId: string;
  token: string;
  /** How the guest chose to pay, when this device knows. */
  payment?: "card" | "paypal" | "cash";
  /** Carried over from the cart when a payment was cancelled or failed —
   *  the order stands, only the payment didn't. */
  note?: "cancelled" | "failed";
  /** The card sheet already succeeded — show paid before the webhook lands. */
  paid?: boolean;
  /** The cart previewed a reward the server didn't end up applying (it
   *  expired, or was spent elsewhere) — said once, then dismissed. */
  rewardFailed?: boolean;
  /** Same for a gift card the server refused: the order stands, the
   *  discount didn't happen, and the guest is told once. */
  giftCardFailed?: boolean;
  /** Open the order's problem thread with the screen: the guest asked
   *  for it from the orders list, not from the tracking view. */
  issue?: boolean;
}

function Shell(): React.ReactElement {
  const cart = useCart();
  const auth = useAuth();
  const { t, lang, applyVenueLocales } = useI18n();
  const insets = useSafeAreaInsets();
  const restaurant = auth.staff !== null;
  const [openOrders, setOpenOrders] = useState(0);
  /** Complaints the restaurant still owes an answer or a verdict on —
   *  the owner menu's badge. Same 30 s loop as the board's count. */
  const [openIssues, setOpenIssues] = useState(0);
  /**
   * The menu AND the language it is written in, kept together on purpose.
   *
   * They used to be two facts in one variable: `menu` alone could not say
   * whether the dish names on screen were the ones the guest had just
   * asked for, so a language switch left the previous language's menu up
   * — indefinitely if the refetch failed. Pairing them makes "is this the
   * right language?" a comparison rather than an assumption.
   */
  const [loaded, setLoaded] = useState<{ menu: ApiMenu; lang: Lang } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [welcomed, setWelcomed] = useState(false);
  /** Decided once, the moment auth restoration settles: a device that is
   *  already signed in never sees the welcome screen — not even while the
   *  menu is still loading. */
  const [skipWelcome, setSkipWelcome] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [presetType, setPresetType] = useState<OrderType | null>(null);
  const [track, setTrack] = useState<TrackTarget | null>(null);
  const [ordersRefresh, setOrdersRefresh] = useState(0);
  /** Bumped when a push lands while the app is open — the board re-reads
   *  rather than waiting out the rest of its poll interval (P7-11). */
  const [boardRefresh, setBoardRefresh] = useState(0);
  /** The complaint a push asked us to open, handed to IssuesScreen. */
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [ownerMenu, setOwnerMenu] = useState(false);
  /** The owner's "change my password" sheet. A sheet, not a tab: it is a
   *  one-off errand with no screen to return to. */
  const [passwordSheet, setPasswordSheet] = useState(false);
  /** The order a scanned delivery ticket asked us to send out. */
  const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null);

  /**
   * The menu, and everything clock-shaped riding on it (`openNow`,
   * `acceptsAsapNow`, today's `requestSlots`), used to be read ONCE per
   * process: a tablet left on the pass still showed last night's hours,
   * and an owner who edited them watched nothing change. It is now
   * re-read on four triggers — see `useEffect` below and the
   * `onMenuChanged` threading further down.
   *
   * A refetch never clears `menu`: the current payload stays on screen
   * until a new one lands, so a refresh is invisible unless something
   * actually changed. A failed one leaves the last good menu in place.
   *
   * With ONE exception, and it is the whole point of `menuCurrent`
   * below: a refetch triggered by a LANGUAGE change. There the payload
   * on screen is not merely old, it is in the language the guest just
   * asked to stop seeing — so it is taken down for the moment the new
   * one takes to arrive, and a failure says so instead of quietly
   * leaving German dish names under Arabic chrome.
   */
  const lastLoad = useRef(0);
  /** Which read is the current one. Two menu requests can be in flight at
   *  once (the language just changed, or a five-minute refresh overlapped
   *  a switch) and nothing orders the responses — an older one landing
   *  last used to repaint the screen in the language the guest had left. */
  const loadSeq = useRef(0);
  const load = useCallback(
    (options?: { fresh?: boolean }) => {
      const seq = ++loadSeq.current;
      const wanted = lang;
      setLoadError(false);
      lastLoad.current = Date.now();
      fetchMenu(wanted, options)
        .then((next) => {
          if (seq !== loadSeq.current) return; // superseded mid-flight
          // The server says which language it actually served: asking for
          // one the venue does not publish gets the house language back.
          // File the payload under THAT, not under what we asked for —
          // `applyVenueLocales` below then moves the app onto it, and
          // until it does this menu is correctly treated as not current.
          setLoaded({ menu: next, lang: toLang(next.venue.locale) ?? wanted });
        })
        .catch(() => {
          if (seq === loadSeq.current) setLoadError(true);
        });
    },
    [lang],
  );
  /** The language the menu on screen was last requested for — the
   *  difference between a first load and a switch. */
  const requestedLang = useRef<Lang | null>(null);
  useEffect(() => {
    // A language change bypasses the edge copy AND both native HTTP
    // caches (`cache: "reload"`, `Cache-Control: no-cache`): the payload
    // is answered `public, s-maxage=60, stale-while-revalidate=300`, and
    // a client cache applying its own heuristic freshness to that is
    // exactly how a switch ends up showing yesterday's language.
    const switched = requestedLang.current !== null && requestedLang.current !== lang;
    requestedLang.current = lang;
    load({ fresh: switched });
  }, [lang, load]);

  /** An explicit re-read that bypasses the edge copy (`?fresh=1`). */
  const refresh = useCallback(() => load({ fresh: true }), [load]);

  // (a) Back from the background, and (b) every five minutes while the
  // app is in front. The `minAge` guard is the debounce: a foreground
  // arrival within 10 s of the last read (app-switcher peek, a returning
  // payment sheet, the permission dialog) costs nothing, and the timer
  // never piles onto a refetch that just happened.
  useEffect(() => {
    const maybeRefresh = (minAge: number): void => {
      if (Date.now() - lastLoad.current >= minAge) refresh();
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") maybeRefresh(FOREGROUND_DEBOUNCE_MS);
    });
    // Ticks once a minute and refreshes at most every five: JS timers are
    // frozen in the background, so a 5-minute interval could fire late
    // (or not at all) after a long sleep — the age check, not the
    // interval, is what defines "every 5 minutes".
    const timer = setInterval(() => {
      if (AppState.currentState === "active") maybeRefresh(ACTIVE_REFRESH_MS);
    }, 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  /** The last payload we received, whatever language it is in. Its
   *  untranslated parts (venue name, currency, payment methods) stay
   *  usable while a switch is in flight. */
  const menu = loaded?.menu ?? null;
  /** ...and whether it is in the language the app is currently speaking.
   *  False for exactly as long as a switch takes. */
  const menuCurrent = loaded !== null && loaded.lang === lang;

  // The venue decides which languages exist: narrow the picker and the
  // device default to what it actually publishes (and that the app has
  // copy for). Idempotent — safe to run on every menu refresh.
  useEffect(() => {
    if (menu) applyVenueLocales(menu.venue);
  }, [menu, applyVenueLocales]);

  // A republished menu invalidates persisted cart item ids — re-anchor
  // the cart to whatever the server is serving right now.
  const reconcile = cart.reconcile;
  useEffect(() => {
    if (menu) reconcile(menu.categories.flatMap((c) => c.items));
  }, [menu, reconcile]);

  // Signing in (or out) as the restaurant changes which tabs exist, so
  // the current one may no longer be among them. Runs on the TRANSITION
  // only — afterwards the owner is free to walk between Home and Board.
  useEffect(() => {
    if (restaurant) {
      // The counter tablet has no use for the welcome splash.
      setWelcomed(true);
      setTab((current) => (current === "menu" || current === "info" ? current : "board"));
    } else {
      setTab((current) => (OWNER_ONLY.includes(current) ? "home" : current));
    }
  }, [restaurant]);

  // Opening the app when there is already a session — the owner's counter
  // tablet, or a guest who signed in on an earlier run — goes straight to
  // the menu. Runs ONCE, on the render where `auth.ready` first turns
  // true: after that the owner (and the guest) navigate freely, and a
  // sign-in performed inside the app leaves the user where they are.
  const authReady = auth.ready;
  const hasSession = auth.staff !== null || auth.token !== null;
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || !authReady) return;
    decided.current = true;
    if (!hasSession) return;
    setSkipWelcome(true);
    setWelcomed(true);
    setTab("menu");
  }, [authReady, hasSession]);

  // The Board tab's badge. Cheap enough to keep running from any tab —
  // that is the point: the owner should see work arrive while they are
  // somewhere else.
  const staffToken = auth.staffToken;
  const clearStaff = auth.clearStaff;
  useEffect(() => {
    if (!staffToken) {
      setOpenOrders(0);
      setOpenIssues(0);
      return;
    }
    let alive = true;
    const tick = async (): Promise<void> => {
      const res = await fetchStaffSummary(staffToken);
      if (!alive) return;
      if (res.ok) {
        setOpenOrders(res.data.openOrders);
        setOpenIssues(res.data.openIssues);
      } else if (res.error === "unauthorized") clearStaff();
      // Offline: keep the last count rather than flashing a zero.
    };
    void tick();
    const timer = setInterval(() => void tick(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [staffToken, clearStaff]);

  // Push (P7-11). Registration is attempted whenever a staff session
  // exists — on sign-in AND on every cold start, because a token can be
  // rotated by the OS and the server's row has to follow. Everything it
  // needs may be missing (simulator, denied permission, no EAS project
  // id, ⛔ APNs/FCM credentials not uploaded yet); each of those is a
  // quiet no-op, never an error the owner has to read.
  const pushChannel = t.pushChannelOrders;
  useEffect(() => {
    if (!staffToken) return;
    void registerForStaffPush(staffToken, { channelName: pushChannel });
  }, [staffToken, pushChannel]);

  // A tap always lands on the screen the push is ABOUT, from wherever the
  // app happened to be — including a cold start.
  const onPushTarget = useCallback((target: PushTarget) => {
    setTrack(null);
    if (target.kind === "order") {
      setOpenIssueId(null);
      setTab("board");
      setBoardRefresh((n) => n + 1);
      return;
    }
    setOpenIssueId(target.issueId);
    setTab("issues");
  }, []);
  // Foreground arrival: not a navigation, just news the board should
  // already be showing.
  const onPushReceived = useCallback(() => setBoardRefresh((n) => n + 1), []);
  usePushRouting({ enabled: restaurant, onTarget: onPushTarget, onReceived: onPushReceived });

  /**
   * The delivery ticket's QR — `https://<site>/dispatch/{orderId}?t=…`.
   *
   * On a phone with this app installed and verified for the site, the OS
   * hands us that link instead of opening the browser. `useLinkingURL()`
   * is expo-linking 57's recommended hook: it returns the URL that cold-
   * started the app AND every one that arrives while it is running, so
   * one effect covers both. It keeps returning the same value, hence the
   * `handled` ref — re-running it on an unrelated state change would
   * re-open the screen under the driver.
   *
   * Two forks, and NEITHER is an error:
   *  - staff session ⇒ the in-app confirm screen;
   *  - anyone else (a guest's phone that happens to have the app, or a
   *    staff phone signed out) ⇒ the web dispatch page, which is a
   *    complete flow for any phone and always has been. The token in the
   *    URL is the authorisation there, so nothing is lost.
   *
   * The decision waits for `auth.ready`: a cold start via the link races
   * the session restore, and deciding "not staff" on a token that has
   * simply not been read yet would bounce a driver into the browser.
   *
   * Every other deep link this app receives — `payment-return`,
   * `auth-return` — is consumed by the in-app browser that opened it, so
   * anything that is not `/dispatch/{id}` is deliberately ignored here.
   */
  const linkUrl = ExpoLinking.useLinkingURL();
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!linkUrl || !authReady || handledLink.current === linkUrl) return;
    const { path } = ExpoLinking.parse(linkUrl);
    const orderId = /^\/?dispatch\/([^/?#]+)/.exec(path ?? "")?.[1];
    if (!orderId) return;
    handledLink.current = linkUrl;
    // A cold-start URL is cached by the native module; clearing it stops
    // the same scan being replayed if this effect ever runs again.
    ExpoLinking.clearInitialURL();
    if (!staffToken) {
      void openInAppBrowser(linkUrl);
      return;
    }
    setTrack(null);
    setDispatchOrderId(decodeURIComponent(orderId));
    setTab("dispatch");
  }, [linkUrl, authReady, staffToken]);

  const offerCount = menu?.offerCount ?? 0;

  const onAdd = useCallback((item: ApiItem) => cart.add(item), [cart]);
  const onPlaced = useCallback(
    (
      order: PlacedOrder,
      info: {
        payment: "card" | "paypal" | "cash";
        note?: "cancelled" | "failed";
        paid?: boolean;
        rewardFailed?: boolean;
        giftCardFailed?: boolean;
      },
    ) => {
      setOrdersRefresh((n) => n + 1);
      setTrack({ orderId: order.orderId, token: order.receiptToken, ...info });
    },
    [],
  );
  const onOpenStored = useCallback((order: StoredOrder, options?: { issue?: boolean }) => {
    setTrack({
      orderId: order.orderId,
      token: order.receiptToken,
      payment: order.payment,
      issue: options?.issue,
    });
  }, []);

  /**
   * "Complaint" on the home screen.
   *
   * A complaint is always ABOUT something — the server files it against
   * an order id — so this picks the guest's most recent stored order and
   * opens the Track screen already in the complaint flow, exactly as the
   * same button on the Orders list does. With nothing stored there is
   * nothing to complain about yet, and saying so is better than opening
   * an empty form.
   */
  const onComplain = useCallback(() => {
    void listStoredOrders()
      .then((orders) => {
        // The store writes newest-first, but the timestamp is what
        // "most recent" actually means — don't rely on the order.
        const latest = orders.reduce<StoredOrder | null>(
          (newest, order) => (!newest || order.placedAt > newest.placedAt ? order : newest),
          null,
        );
        if (!latest) {
          Alert.alert(t.complainNoOrdersTitle, t.complainNoOrdersBody);
          return;
        }
        onOpenStored(latest, { issue: true });
      })
      .catch(() => Alert.alert(t.complainNoOrdersTitle, t.complainNoOrdersBody));
  }, [onOpenStored, t]);

  if (!menu || !welcomed) {
    // Either we don't yet know whether this device has a session, or we
    // know it has one: both are "not the welcome INVITATION". The launch
    // page's loading variant stands in — same artwork, no entries — so
    // nothing flashes past on the way to the menu.
    // `hasSession` is read here rather than waiting for `skipWelcome`,
    // which an effect sets only AFTER the first paint — one frame of
    // Willkommen is exactly what this is meant to prevent. `skipWelcome`
    // then holds the decision even if the restored token turns out to be
    // stale and is dropped while the menu is still loading.
    if (!authReady || hasSession || skipWelcome) {
      // The SAME launch page a guest sees, minus the two entries: a
      // device with a session opens onto the app's own face rather than
      // a stripped-down holding screen (see `WelcomeScreen`).
      return <WelcomeScreen variant="loading" loadError={loadError} onRetry={refresh} />;
    }
    return (
      <WelcomeScreen
        ready={Boolean(menu)}
        loadError={loadError}
        onRetry={refresh}
        onStart={() => {
          setTab("home");
          setWelcomed(true);
        }}
        onAccount={() => {
          setTab("info");
          setWelcomed(true);
        }}
      />
    );
  }

  if (track) {
    return (
      <TrackScreen
        orderId={track.orderId}
        token={track.token}
        merchantName={menu.venue.name}
        canPayCard={Boolean(menu.ordering.onlinePayment)}
        canPayPaypal={Boolean(menu.ordering.paypal)}
        wallets={walletsFromAccepted(menu.ordering.acceptedPayments)}
        payment={track.payment}
        paidHint={track.paid}
        note={track.note}
        rewardFailed={track.rewardFailed}
        giftCardFailed={track.giftCardFailed}
        openIssue={track.issue}
        onBack={() => setTrack(null)}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      {/* Remounted on every language change. Screens keep menu-derived
          snapshots of their own — the open dish sheet, a chip row, a
          scroll offset measured against the old names — and a switch is
          the one moment all of it is guaranteed wrong. */}
      <View style={{ flex: 1 }} key={lang}>
        {/* A switch is in flight: the dish text on screen is the language
            the guest just left, so it is not shown at all. The chrome —
            header space, the tab bar below — stays put, and the panel
            speaks the NEW language. Account is the exception: it owns the
            picker, and covering it would swallow the only feedback the
            tap has (P: "Smooth: no flash of the old language"). */}
        {!menuCurrent && tab !== "info" ? (
          <MenuLoading error={loadError} onRetry={refresh} />
        ) : null}
        {menuCurrent && tab === "home" ? (
          <HomeScreen
            menu={menu}
            onAdd={onAdd}
            onOpenOwnerMenu={restaurant ? () => setOwnerMenu(true) : undefined}
            onMenuChanged={refresh}
            onOpenCategory={(id) => {
              setCategoryId(id);
              setTab("menu");
            }}
            // Same threading as a category: the Menu tab is remounted on
            // every switch, so its initial chip is simply this id (P7-12).
            onOpenOffers={() => {
              setCategoryId(OFFERS_CATEGORY_ID);
              setTab("menu");
            }}
            onBrowseAll={() => {
              setCategoryId(null);
              setTab("menu");
            }}
            onStartOrder={(type) => {
              setPresetType(type);
              setTab("menu");
            }}
            onOpenAccount={() => setTab("info")}
            onOpenGiftCards={() => setTab("giftcards")}
            onComplain={onComplain}
          />
        ) : null}
        {menuCurrent && tab === "menu" ? (
          <MenuScreen
            menu={menu}
            initialCategoryId={categoryId}
            onAdd={onAdd}
            onOpenOwnerMenu={restaurant ? () => setOwnerMenu(true) : undefined}
            onMenuChanged={refresh}
          />
        ) : null}
        {menuCurrent && tab === "cart" && !restaurant ? (
          <CartScreen menu={menu} presetType={presetType} onPlaced={onPlaced} />
        ) : null}
        {menuCurrent && tab === "orders" && !restaurant ? (
          <OrdersScreen refreshKey={ordersRefresh} onOpen={onOpenStored} />
        ) : null}
        {menuCurrent && tab === "board" && restaurant ? (
          <BoardScreen refreshKey={boardRefresh} onOpenOwnerMenu={() => setOwnerMenu(true)} />
        ) : null}
        {menuCurrent && tab === "loyalty" && restaurant ? (
          <LoyaltyStaffScreen
            currency={menu.venue.currency}
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {menuCurrent && tab === "issues" && restaurant ? (
          <IssuesScreen
            // A push tap opens the thread it was about; reached from the
            // owner's burger it is just the list (P7-11).
            initialIssueId={openIssueId}
            onBack={() => {
              setOpenIssueId(null);
              setTab("board");
            }}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {menuCurrent && tab === "rating" && restaurant ? (
          <RatingOwnerScreen
            venueName={menu.venue.name}
            // The rating rides on the menu payload — a saved (or
            // refreshed) rating has to reach the header's stars.
            onMenuChanged={refresh}
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {menuCurrent && tab === "hours" && restaurant ? (
          <HoursOwnerScreen
            // Saved hours change `openNow`, `acceptsAsapNow` and today's
            // slots on the public payload every other screen reads.
            onSaved={refresh}
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {menuCurrent && tab === "contact" && restaurant ? (
          <ContactOwnerScreen
            // The phone book is published with the menu.
            onMenuChanged={refresh}
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {menuCurrent && tab === "giftcards" && !restaurant ? (
          <GiftCardsScreen
            menu={menu}
            onBack={() => setTab("home")}
            // Buying needs an account; the form for one lives on the
            // Account tab, and this is the soft gate that points there.
            onOpenAccount={() => setTab("info")}
          />
        ) : null}
        {menuCurrent && tab === "mygiftcards" && !restaurant ? (
          <MyGiftCardsScreen venueName={menu.venue.name} onBack={() => setTab("info")} />
        ) : null}
        {menuCurrent && tab === "redeemgift" && restaurant ? (
          <RedeemGiftCardScreen
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {menuCurrent && tab === "giftcardsowner" && restaurant ? (
          <GiftCardsOwnerScreen
            currency={menu.venue.currency}
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {menuCurrent && tab === "dispatch" && restaurant && dispatchOrderId ? (
          <DispatchScreen
            orderId={dispatchOrderId}
            onBack={() => {
              setDispatchOrderId(null);
              setTab("board");
            }}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {tab === "info" ? (
          <AccountScreen
            menu={menu}
            menuLoading={!menuCurrent && !loadError}
            menuError={!menuCurrent && loadError}
            onOpenOrder={(orderId, token) => setTrack({ orderId, token })}
            onOpenGiftCards={() => setTab("mygiftcards")}
            onOpenOwnerMenu={restaurant ? () => setOwnerMenu(true) : undefined}
          />
        ) : null}
      </View>

      {/* The wrapper owns the side inset so the bar's own `width: 100%`
          resolves inside it — a maxWidth plus a horizontal margin would
          overflow by exactly the margin on a narrow phone. */}
      <View style={[styles.tabBarWrap, { marginBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.tabBar}>
          <TabButton
            label={t.tabStart}
            icon="home"
            active={tab === "home"}
            onPress={() => setTab("home")}
          />
          <TabButton
            label={t.tabMenu}
            icon="grid"
            // What is on offer right now — the one number on this bar that
            // is about the menu rather than about this device (P7-12).
            badge={offerCount > 0 ? offerCount : undefined}
            active={tab === "menu"}
            onPress={() => setTab("menu")}
          />
          {/* The middle of the bar is whichever job this device has: the
            guest's basket + receipts, or the restaurant's board. */}
          {restaurant ? (
            <TabButton
              label={t.tabBoard}
              icon="restaurant"
              badge={openOrders > 0 ? openOrders : undefined}
              active={tab === "board"}
              onPress={() => setTab("board")}
            />
          ) : (
            <>
              <TabButton
                label={t.tabCart}
                icon="cart"
                badge={cart.count > 0 ? cart.count : undefined}
                active={tab === "cart"}
                onPress={() => setTab("cart")}
              />
              <TabButton
                label={t.tabOrders}
                icon="receipt"
                active={tab === "orders"}
                onPress={() => setTab("orders")}
              />
            </>
          )}
          <TabButton
            label={t.tabAccount}
            icon="person"
            active={tab === "info"}
            onPress={() => setTab("info")}
          />
        </View>
      </View>

      {/* Everything the restaurant can do that isn't a tab. Mounted only
          in restaurant mode, so a guest device has no path to it. */}
      {restaurant ? (
        <OwnerMenuSheet
          visible={ownerMenu}
          onClose={() => setOwnerMenu(false)}
          onBoard={() => setTab("board")}
          onManageMenu={() => {
            setCategoryId(null);
            setTab("menu");
          }}
          onLoyalty={() => setTab("loyalty")}
          onRedeemGiftCard={() => setTab("redeemgift")}
          onGiftCards={() => setTab("giftcardsowner")}
          onIssues={() => {
            // Reached deliberately: the list, not whatever thread a push
            // happened to open earlier.
            setOpenIssueId(null);
            setTab("issues");
          }}
          onRating={() => setTab("rating")}
          onHours={() => setTab("hours")}
          onContact={() => setTab("contact")}
          // A sheet rather than a tab: changing a password is a single
          // errand with nothing to come back to, and the owner's menu is
          // where it was opened from.
          onPassword={() => setPasswordSheet(true)}
          openIssues={openIssues}
        />
      ) : null}
      {restaurant ? (
        <PasswordSheet visible={passwordSheet} onClose={() => setPasswordSheet(false)} />
      ) : null}
    </View>
  );
}

/**
 * The menu is being refetched in the language just picked.
 *
 * Deliberately opaque and deliberately full-bleed: a translucent veil
 * over the previous language would still be a screen of German behind a
 * haze, which is the thing the guest just asked to stop seeing. Same
 * words as the launch screen's loading slot, in the NEW language,
 * because that is the language the app is already speaking.
 *
 * "Try again" appears immediately on a failure, and after a patient wait
 * even without one: a request that neither resolves nor rejects (a
 * captive portal, a proxy holding the socket open) is otherwise a
 * spinner with no way out.
 */
const PATIENCE_MS = 6000;
function MenuLoading({
  error,
  onRetry,
}: {
  error: boolean;
  onRetry: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={styles.menuLoading} accessibilityRole="progressbar">
      {error ? null : <ActivityIndicator color={colors.red} />}
      <Text style={styles.menuLoadingText}>{error ? t.bootError : t.bootLoading}</Text>
      {error || waited ? <OutlineButton label={t.bootRetry} onPress={onRetry} /> : null}
    </View>
  );
}

function TabButton({
  label,
  icon,
  active,
  badge,
  onPress,
}: {
  label: string;
  icon: "home" | "grid" | "cart" | "receipt" | "person" | "restaurant";
  active: boolean;
  badge?: number;
  onPress: () => void;
}): React.ReactElement {
  // Mockup's tab language: filled mark when active, outline when not.
  const name = (active ? icon : `${icon}-outline`) as keyof typeof Ionicons.glyphMap;
  // A count that moves while the guest is on another tab is the whole
  // reason this badge exists — a dish added from the menu, an order
  // arriving on the board — so it pops when the number changes. The bump
  // is keyed on 0 for "no badge" so appearing and disappearing count as
  // changes too, and it deliberately does not fire on mount: every tab
  // bouncing at launch would say "new" about a basket from yesterday.
  const bump = useBumpOnChange(badge ?? 0);
  return (
    <Pressable onPress={onPress} style={styles.tabBtn} accessibilityLabel={label}>
      <View>
        <Ionicons
          name={name}
          size={22}
          color={active ? colors.goldSoft : colors.onRed}
          style={!active && { opacity: 0.7 }}
        />
        {badge ? (
          <Animated.View style={[styles.badge, bump]}>
            <Text style={styles.badgeText}>{badge > 99 ? "99" : badge}</Text>
          </Animated.View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

export default function App(): React.ReactElement {
  // One family for the whole app now (see `theme.ts`): the display serif
  // went when the owner asked for every heading to be set in the venue
  // name's own face. Until the faces are ready render brand red, so the
  // launch never flashes unstyled text.
  const [fontsLoaded] = useFonts({
    Nunito_300Light,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_800ExtraBold_Italic,
    Amiri_700Bold,
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: colors.red }} />;
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <CartProvider>
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.red }} edges={["top"]}>
              <StatusBar style="light" />
              <Shell />
            </SafeAreaView>
          </CartProvider>
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // The mockup's floating pill bar: inset from the screen edges with a
  // long rounded arc on every corner, buttons drawn in toward each other.
  menuLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
    backgroundColor: colors.cream,
  },
  menuLoadingText: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 14, textAlign: "center" },
  tabBarWrap: { paddingHorizontal: 12, marginTop: 6 },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.red,
    // On a tablet the bar stops growing and centres: five buttons
    // stretched across 1366 pt is a ribbon nobody's thumb can work.
    width: "100%",
    maxWidth: TAB_BAR_MAX,
    alignSelf: "center",
    borderRadius: 28,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  tabBtn: { flex: 1, alignItems: "center", gap: 3 },
  tabLabel: { color: colors.onRed, opacity: 0.6, ...fonts.body, fontSize: 10 },
  tabLabelActive: { opacity: 1, ...fonts.bodyBold },
  badge: {
    position: "absolute",
    top: -4,
    end: -10,
    backgroundColor: colors.goldSoft,
    borderRadius: 999,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.ink, fontSize: 10, ...fonts.bodyHeavy },
});
