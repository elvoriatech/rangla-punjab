import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import {
  useFonts,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_800ExtraBold,
  PlayfairDisplay_600SemiBold_Italic,
} from "@expo-google-fonts/playfair-display";
import {
  Nunito_300Light,
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from "@expo-google-fonts/nunito";
import type { ApiMenu, ApiItem, OrderType, PlacedOrder } from "./src/api";
import { fetchMenu, OFFERS_CATEGORY_ID } from "./src/api";
import { CartProvider, useCart } from "./src/cart";
import { AuthProvider, useAuth } from "./src/auth";
import { I18nProvider, useI18n } from "./src/i18n";
import type { StoredOrder } from "./src/orders-store";
import type { PushTarget } from "./src/push";
import { registerForStaffPush, usePushRouting } from "./src/push";
import { fetchStaffSummary } from "./src/staff";
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
import { WelcomeScreen } from "./src/screens/WelcomeScreen";
import { OwnerMenuSheet } from "./src/owner-menu";

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

/** "loyalty", "issues", "rating", "hours" and "contact" have no tab button: they
 *  are reached from the owner's burger and carry their own back arrow,
 *  like the tracking view. */
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
  | "info";

/** The owner-only views, which a guest device must never be left on. */
const OWNER_ONLY: readonly Tab[] = ["board", "loyalty", "issues", "rating", "hours", "contact"];
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
  const [menu, setMenu] = useState<ApiMenu | null>(null);
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

  const load = useCallback(() => {
    setLoadError(false);
    fetchMenu(lang)
      .then(setMenu)
      .catch(() => setLoadError(true));
  }, [lang]);
  useEffect(load, [load]);

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
      return <WelcomeScreen variant="loading" loadError={loadError} onRetry={load} />;
    }
    return (
      <WelcomeScreen
        ready={Boolean(menu)}
        loadError={loadError}
        onRetry={load}
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
        payment={track.payment}
        paidHint={track.paid}
        note={track.note}
        rewardFailed={track.rewardFailed}
        openIssue={track.issue}
        onBack={() => setTrack(null)}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <View style={{ flex: 1 }}>
        {tab === "home" ? (
          <HomeScreen
            menu={menu}
            onAdd={onAdd}
            onOpenOwnerMenu={restaurant ? () => setOwnerMenu(true) : undefined}
            onMenuChanged={load}
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
          />
        ) : null}
        {tab === "menu" ? (
          <MenuScreen
            menu={menu}
            initialCategoryId={categoryId}
            onAdd={onAdd}
            onOpenOwnerMenu={restaurant ? () => setOwnerMenu(true) : undefined}
            onMenuChanged={load}
          />
        ) : null}
        {tab === "cart" && !restaurant ? (
          <CartScreen menu={menu} presetType={presetType} onPlaced={onPlaced} />
        ) : null}
        {tab === "orders" && !restaurant ? (
          <OrdersScreen refreshKey={ordersRefresh} onOpen={onOpenStored} />
        ) : null}
        {tab === "board" && restaurant ? (
          <BoardScreen refreshKey={boardRefresh} onOpenOwnerMenu={() => setOwnerMenu(true)} />
        ) : null}
        {tab === "loyalty" && restaurant ? (
          <LoyaltyStaffScreen
            currency={menu.venue.currency}
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {tab === "issues" && restaurant ? (
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
        {tab === "rating" && restaurant ? (
          <RatingOwnerScreen
            venueName={menu.venue.name}
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {tab === "hours" && restaurant ? (
          <HoursOwnerScreen
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {tab === "contact" && restaurant ? (
          <ContactOwnerScreen
            onBack={() => setTab("board")}
            onOpenOwnerMenu={() => setOwnerMenu(true)}
          />
        ) : null}
        {tab === "info" ? (
          <AccountScreen
            menu={menu}
            onOpenOrder={(orderId, token) => setTrack({ orderId, token })}
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
          onIssues={() => {
            // Reached deliberately: the list, not whatever thread a push
            // happened to open earlier.
            setOpenIssueId(null);
            setTab("issues");
          }}
          onRating={() => setTab("rating")}
          onHours={() => setTab("hours")}
          onContact={() => setTab("contact")}
          openIssues={openIssues}
        />
      ) : null}
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
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 99 ? "99" : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

export default function App(): React.ReactElement {
  // The mockup's display serif; until it's ready render brand red so the
  // launch never flashes unstyled text.
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_800ExtraBold,
    PlayfairDisplay_600SemiBold_Italic,
    Nunito_300Light,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
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
