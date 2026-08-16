import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StoredOrder } from "../orders-store";
import { listStoredOrders } from "../orders-store";
import { BrandHeader } from "../components";
import { colors, money, radius } from "../theme";
import { useI18n } from "../i18n";

/**
 * Bestellungen — this device's order history. The receipt tokens stored
 * locally ARE the history: no account, nothing about this phone lives
 * on the server (same posture as the web receipt link).
 */
export function OrdersScreen({
  refreshKey,
  onOpen,
}: {
  refreshKey: number;
  onOpen: (order: StoredOrder) => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const load = useCallback(() => {
    void listStoredOrders().then(setOrders);
  }, []);
  useEffect(load, [load, refreshKey]);

  const typeLabel = t.typeLabels as Record<string, string>;
  const locale = lang === "de" ? "de-DE" : "en-GB";
  const dateFmt = (iso: string): string => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(locale)} · ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.ordersTitle} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
        {orders.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>🧾</Text>
            <Text style={styles.emptyTitle}>{t.ordersEmpty}</Text>
            <Text style={styles.emptySub}>{t.ordersEmptySub}</Text>
          </View>
        ) : (
          orders.map((order) => (
            <Pressable key={order.orderId} style={styles.row} onPress={() => onOpen(order)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.number}>#{String(order.orderNumber).padStart(4, "0")}</Text>
                <Text style={styles.meta}>
                  {dateFmt(order.placedAt)} · {typeLabel[order.orderType] ?? order.orderType}
                </Text>
              </View>
              <Text style={styles.total}>{money(order.totalCents, order.currency)}</Text>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 6, paddingVertical: 60 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: "700" },
  emptySub: { color: colors.inkSoft, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
  },
  number: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  meta: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  total: { color: colors.red, fontSize: 14, fontWeight: "800" },
  chev: { color: colors.inkSoft, fontSize: 22, marginLeft: 2 },
});
