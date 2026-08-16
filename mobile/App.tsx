import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import type { ApiMenu, ApiItem, OrderType, PlacedOrder } from "./src/api";
import { fetchMenu } from "./src/api";
import { CartProvider, useCart } from "./src/cart";
import { AuthProvider } from "./src/auth";
import { I18nProvider, useI18n } from "./src/i18n";
import type { StoredOrder } from "./src/orders-store";
import { colors } from "./src/theme";
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
}

function Shell(): React.ReactElement {
  const cart = useCart();
  const { t, lang } = useI18n();
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

  const onAdd = useCallback((item: ApiItem) => cart.add(item), [cart]);
  const onPlaced = useCallback((order: PlacedOrder) => {
    setOrdersRefresh((n) => n + 1);
    setTrack({ orderId: order.orderId, token: order.receiptToken });
  }, []);
  const onOpenStored = useCallback((order: StoredOrder) => {
    setTrack({ orderId: order.orderId, token: order.receiptToken });
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
        canPayOnline={Boolean(menu.ordering.onlinePayment || menu.ordering.paypal)}
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
        <Ionicons name={name} size={22} color={colors.onRed} style={!active && { opacity: 0.6 }} />
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
  bootBrand: { color: colors.onRed, fontSize: 30, fontWeight: "800" },
  bootSub: { color: colors.goldSoft, fontSize: 12, letterSpacing: 4 },
  bootState: { color: colors.onRed, opacity: 0.85, marginTop: 20, fontSize: 14 },
  bootRetry: {
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  bootRetryText: { color: colors.goldSoft, fontWeight: "700" },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.red,
    paddingTop: 8,
    paddingBottom: 18,
    paddingHorizontal: 4,
  },
  tabBtn: { flex: 1, alignItems: "center", gap: 2 },
  tabLabel: { color: colors.onRed, opacity: 0.6, fontSize: 10 },
  tabLabelActive: { opacity: 1, fontWeight: "700" },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    backgroundColor: colors.goldSoft,
    borderRadius: 999,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.ink, fontSize: 10, fontWeight: "800" },
});
