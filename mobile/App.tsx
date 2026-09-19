import React, { useCallback, useEffect, useState } from "react";
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
import { fetchMenu } from "./src/api";
import { CartProvider, useCart } from "./src/cart";
import { AuthProvider } from "./src/auth";
import { I18nProvider, useI18n } from "./src/i18n";
import type { StoredOrder } from "./src/orders-store";
import { colors, fonts } from "./src/theme";
import { HomeScreen } from "./src/screens/HomeScreen";
import { MenuScreen } from "./src/screens/MenuScreen";
import { CartScreen } from "./src/screens/CartScreen";
import { OrdersScreen } from "./src/screens/OrdersScreen";
import { TrackScreen } from "./src/screens/TrackScreen";
import { AccountScreen } from "./src/screens/AccountScreen";
import { WelcomeScreen } from "./src/screens/WelcomeScreen";

/**
 * Rangla Punjab — the single-restaurant guest app. One hand-rolled tab
 * shell (no navigation library: five tabs and one detail view don't
 * earn a dependency), the mockup's red/cream/gold identity throughout.
 * No accounts anywhere: the receipt tokens this device holds are the
 * entire order history.
 */

type Tab = "home" | "menu" | "cart" | "orders" | "info";
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
}

function Shell(): React.ReactElement {
  const cart = useCart();
  const { t, lang, applyVenueLocales } = useI18n();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<ApiMenu | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [welcomed, setWelcomed] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [presetType, setPresetType] = useState<OrderType | null>(null);
  const [track, setTrack] = useState<TrackTarget | null>(null);
  const [ordersRefresh, setOrdersRefresh] = useState(0);

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

  const onAdd = useCallback((item: ApiItem) => cart.add(item), [cart]);
  const onPlaced = useCallback(
    (
      order: PlacedOrder,
      info: { payment: "card" | "paypal" | "cash"; note?: "cancelled" | "failed"; paid?: boolean },
    ) => {
      setOrdersRefresh((n) => n + 1);
      setTrack({ orderId: order.orderId, token: order.receiptToken, ...info });
    },
    [],
  );
  const onOpenStored = useCallback((order: StoredOrder) => {
    setTrack({ orderId: order.orderId, token: order.receiptToken, payment: order.payment });
  }, []);

  if (!menu || !welcomed) {
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
            onOpenCategory={(id) => {
              setCategoryId(id);
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
          <MenuScreen menu={menu} initialCategoryId={categoryId} onAdd={onAdd} />
        ) : null}
        {tab === "cart" ? (
          <CartScreen menu={menu} presetType={presetType} onPlaced={onPlaced} />
        ) : null}
        {tab === "orders" ? (
          <OrdersScreen refreshKey={ordersRefresh} onOpen={onOpenStored} />
        ) : null}
        {tab === "info" ? (
          <AccountScreen
            menu={menu}
            onOpenOrder={(orderId, token) => setTrack({ orderId, token })}
          />
        ) : null}
      </View>

      <View style={[styles.tabBar, { marginBottom: Math.max(insets.bottom, 12) }]}>
        <TabButton
          label={t.tabStart}
          icon="home"
          active={tab === "home"}
          onPress={() => setTab("home")}
        />
        <TabButton
          label={t.tabMenu}
          icon="grid"
          active={tab === "menu"}
          onPress={() => setTab("menu")}
        />
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
        <TabButton
          label={t.tabAccount}
          icon="person"
          active={tab === "info"}
          onPress={() => setTab("info")}
        />
      </View>
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
  icon: "home" | "grid" | "cart" | "receipt" | "person";
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
  boot: {
    flex: 1,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 24,
  },
  bootBrand: { color: colors.onRed, fontSize: 30, ...fonts.bodyHeavy },
  bootSub: { color: colors.goldSoft, ...fonts.body, fontSize: 12, letterSpacing: 4 },
  bootState: {
    color: colors.onRed,
    opacity: 0.85,
    marginTop: 20,
    ...fonts.body,
    fontSize: 14,
  },
  bootRetry: {
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  bootRetryText: { color: colors.goldSoft, ...fonts.bodyBold },
  // The mockup's floating pill bar: inset from the screen edges with a
  // long rounded arc on every corner, buttons drawn in toward each other.
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.red,
    marginHorizontal: 12,
    marginTop: 6,
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
