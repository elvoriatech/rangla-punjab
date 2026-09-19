import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiTracking } from "../api";
import { fetchOrderStatus } from "../api";
import type { StoredOrder } from "../orders-store";
import { listStoredOrders } from "../orders-store";
import { BrandHeader } from "../components";
import { CHEVRON_FORWARD, colors, fonts, money, radius } from "../theme";
import { localeTag, useI18n } from "../i18n";

/**
 * Bestellungen — this device's order history. The receipt tokens stored
 * locally ARE the history: no account, nothing about this phone lives
 * on the server (same posture as the web receipt link).
 *
 * Each card also shows where the order stands and how it was (or will
 * be) paid. Status comes from the same v1 endpoint the tracking screen
 * polls, fetched for the most recent orders once the list is known; a
 * card whose status has not arrived yet simply shows no pill.
 */

/** How many orders get a live status lookup — the rest are history. */
const STATUS_LOOKUPS = 20;

export function OrdersScreen({
  refreshKey,
  onOpen,
}: {
  refreshKey: number;
  onOpen: (order: StoredOrder) => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [status, setStatus] = useState<Record<string, ApiTracking>>({});
  const load = useCallback(() => {
    void listStoredOrders().then(setOrders);
  }, []);
  useEffect(load, [load, refreshKey]);

  // Tolerant fan-out: one failed lookup (offline, purged order) must not
  // hide the others, so each promise settles on its own.
  useEffect(() => {
    let alive = true;
    const recent = orders.slice(0, STATUS_LOOKUPS);
    if (recent.length === 0) return;
    void Promise.all(
      recent.map((o) =>
        fetchOrderStatus(o.orderId, o.receiptToken)
          .then((s) => [o.orderId, s] as const)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!alive) return;
      const next: Record<string, ApiTracking> = {};
      for (const r of results) if (r) next[r[0]] = r[1];
      setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [orders]);

  const typeLabel = t.typeLabels as Record<string, string>;
  const locale = localeTag(lang);
  const dateFmt = (iso: string): string => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(locale)} · ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  };

  /** The server's own step label: German for German guests, English for
   *  every other language (the server only ships those two). */
  const stepLabel = (s: ApiTracking): string => {
    if (s.status === "done") return t.orderDone;
    const step = s.steps[s.currentStepIndex] ?? s.steps.find((x) => !x.reached);
    if (!step) return t.orderConfirmed;
    return lang === "de" ? step.labelDe : step.labelEn;
  };

  const methodLabel = (payment: StoredOrder["payment"]): string | null =>
    payment === "card"
      ? t.methodCard
      : payment === "paypal"
        ? t.methodPaypal
        : payment === "cash"
          ? t.methodCash
          : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.ordersTitle} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        {orders.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ ...fonts.body, fontSize: 40 }}>🧾</Text>
            <Text style={styles.emptyTitle}>{t.ordersEmpty}</Text>
            <Text style={styles.emptySub}>{t.ordersEmptySub}</Text>
          </View>
        ) : (
          orders.map((order) => {
            const s = status[order.orderId];
            const paid = s?.paymentStatus === "paid";
            const method = methodLabel(order.payment);
            const payText = paid
              ? method
                ? `${t.paidOnline} · ${method}`
                : t.paidOnline
              : order.payment === "cash"
                ? t.methodCash
                : method
                  ? `${t.payNotYet} · ${method}`
                  : null;
            const done = s?.status === "done";
            return (
              <Pressable
                key={order.orderId}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
                onPress={() => onOpen(order)}
                accessibilityRole="button"
                accessibilityLabel={`${t.orderNo} ${order.orderNumber}`}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1, gap: 4 }}>
                    {/* Status sits right beside the number — the first
                        thing a guest looks for on a glance. */}
                    <View style={styles.numberRow}>
                      <Text style={styles.number}>
                        #{String(order.orderNumber).padStart(4, "0")}
                      </Text>
                      {s ? (
                        <View style={[styles.pill, done ? styles.pillDone : styles.pillActive]}>
                          <Text
                            style={[
                              styles.pillText,
                              done ? styles.pillTextDone : styles.pillTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {stepLabel(s)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.meta}>
                      {dateFmt(order.placedAt)} · {typeLabel[order.orderType] ?? order.orderType}
                    </Text>
                  </View>
                  <Text style={styles.total}>{money(order.totalCents, order.currency)}</Text>
                  <Text style={styles.chev}>{CHEVRON_FORWARD}</Text>
                </View>
                {payText ? (
                  <View style={styles.pills}>
                    <View style={[styles.pill, paid ? styles.pillDone : styles.pillNeutral]}>
                      <Text
                        style={[
                          styles.pillText,
                          paid ? styles.pillTextDone : styles.pillTextNeutral,
                        ]}
                      >
                        {payText}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 6, paddingVertical: 60 },
  emptyTitle: { color: colors.ink, fontSize: 17, ...fonts.bodyBold },
  emptySub: { color: colors.inkSoft, ...fonts.body, fontSize: 13, textAlign: "center" },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  number: { color: colors.ink, fontSize: 17, ...fonts.bodyHeavy },
  meta: { color: colors.inkSoft, ...fonts.body, fontSize: 12, marginTop: 3 },
  total: { color: colors.red, fontSize: 16, ...fonts.bodyHeavy },
  chev: { color: colors.inkSoft, ...fonts.body, fontSize: 22, marginStart: 2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pillText: { fontSize: 12, ...fonts.bodyBold },
  // Kitchen progress: brand red on the warm tint used for the active chip.
  pillActive: { backgroundColor: "#fdeee6", borderColor: colors.red },
  pillTextActive: { color: colors.red },
  // Settled — served, or paid: the receipt's green.
  pillDone: { backgroundColor: "#e9f3e4", borderColor: "#3f7030" },
  pillTextDone: { color: "#3f7030" },
  // Cash / not paid yet: quiet.
  pillNeutral: { backgroundColor: colors.cream, borderColor: colors.line },
  pillTextNeutral: { color: colors.inkSoft },
});
