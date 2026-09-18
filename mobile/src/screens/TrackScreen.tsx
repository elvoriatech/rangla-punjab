import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ExpoLinking from "expo-linking";
import type { ApiTracking } from "../api";
import { fetchOrderStatus, payPageUrl, receiptUrl } from "../api";
import { BrandHeader } from "../components";
import { CHEVRON_BACK, colors, fonts, money, radius } from "../theme";
import { useI18n } from "../i18n";

/**
 * Bestellung verfolgen — the mockup's tracking screen. Polls the v1
 * status endpoint every 10 s while the order is open; the server's
 * step list is authoritative (the app renders unknown statuses as
 * "in progress" rather than crashing — tolerant-client rule).
 */
export function TrackScreen({
  orderId,
  token,
  canPayOnline,
  onBack,
}: {
  orderId: string;
  token: string;
  canPayOnline: boolean;
  onBack: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const [tracking, setTracking] = useState<ApiTracking | null>(null);
  const [error, setError] = useState(false);
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load(): Promise<void> {
      if (timer) clearTimeout(timer);
      try {
        const next = await fetchOrderStatus(orderId, token);
        if (!alive) return;
        setTracking(next);
        setError(false);
        if (next.status !== "done") timer = setTimeout(() => void load(), 10_000);
      } catch {
        if (!alive) return;
        setError(true);
        timer = setTimeout(() => void load(), 15_000);
      }
    }
    reloadRef.current = () => void load();
    void load();
    // Coming back from the browser payment (deep link or plain app
    // switch) → re-read the status immediately so "Paid ✓" shows without
    // waiting for the next poll tick.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      alive = false;
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [orderId, token]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.trackTitle} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>
            {CHEVRON_BACK} {t.back}
          </Text>
        </Pressable>
        {!tracking ? (
          <Text style={styles.loading}>{error ? t.retrying : t.loadingOrder}</Text>
        ) : (
          <View style={styles.card}>
            <Text style={styles.confirmed}>
              {tracking.status === "done" ? t.orderDone : t.orderConfirmed}
            </Text>
            <Text style={styles.orderNo}>
              {t.orderNo} #{String(tracking.orderNumber).padStart(4, "0")}
            </Text>
            {tracking.tableNumber ? (
              <Text style={styles.meta}>
                {t.table} {tracking.tableNumber}
              </Text>
            ) : null}

            <View style={styles.steps}>
              {tracking.steps.map((step, i) => {
                const isCurrent = i === tracking.currentStepIndex && tracking.status !== "done";
                return (
                  <View key={step.key} style={styles.stepRow}>
                    <View style={styles.stepRail}>
                      <View
                        style={[
                          styles.dot,
                          step.reached
                            ? isCurrent
                              ? { backgroundColor: colors.red, borderColor: colors.red }
                              : { backgroundColor: colors.positive, borderColor: colors.positive }
                            : null,
                        ]}
                      >
                        <Text style={styles.dotText}>
                          {step.reached && !isCurrent ? "✓" : i + 1}
                        </Text>
                      </View>
                      {i < tracking.steps.length - 1 ? (
                        <View
                          style={[
                            styles.railLine,
                            i < tracking.currentStepIndex && { backgroundColor: colors.positive },
                          ]}
                        />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 18 }}>
                      {/* The server ships only German + English step
                          labels. Show the one that matches the guest, and
                          pair it with the other only for those two
                          languages — a Spanish guest gains nothing from a
                          German subtitle. */}
                      <Text style={[styles.stepPrimary, !step.reached && { opacity: 0.5 }]}>
                        {lang === "de" ? step.labelDe : step.labelEn}
                      </Text>
                      {lang === "de" || lang === "en" ? (
                        <Text style={styles.stepSecondary}>
                          {lang === "de" ? step.labelEn : step.labelDe}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>

            {tracking.items?.length ? (
              <View style={styles.itemsBox}>
                {tracking.items.map((line, i) => (
                  <View key={`${line.name}-${i}`} style={styles.itemRow}>
                    <Text style={styles.itemQty}>{line.quantity}×</Text>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text style={styles.itemPrice}>
                      {money(line.lineTotalCents, tracking.currency)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t.total}</Text>
              <Text style={styles.totalValue}>{money(tracking.totalCents, tracking.currency)}</Text>
            </View>
            <Text style={styles.payState}>
              {tracking.paymentStatus === "paid" ? t.paidOnline : t.payAtRest}
            </Text>

            {canPayOnline && tracking.paymentStatus !== "paid" ? (
              <Pressable
                onPress={() =>
                  void Linking.openURL(
                    payPageUrl(orderId, token, ExpoLinking.createURL("payment-return")),
                  )
                }
                style={styles.payBtn}
              >
                <Text style={styles.payBtnText}>{t.payOnline}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void Linking.openURL(receiptUrl(orderId, token, lang))}
              style={styles.receiptBtn}
            >
              <Text style={styles.receiptBtnText}>{t.receiptPdf}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { color: colors.red, fontSize: 15, ...fonts.bodyBold, marginBottom: 10 },
  loading: { color: colors.inkSoft, textAlign: "center", marginTop: 60 },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 18,
  },
  confirmed: { color: colors.ink, fontSize: 18, ...fonts.bodyHeavy, textAlign: "center" },
  orderNo: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },
  meta: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
  steps: { marginTop: 20 },
  stepRow: { flexDirection: "row", gap: 12 },
  stepRail: { alignItems: "center", width: 30 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
  },
  dotText: { fontSize: 12, ...fonts.bodyHeavy, color: colors.creamCard },
  railLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 2 },
  stepPrimary: { color: colors.ink, fontSize: 14, ...fonts.bodyBold, paddingTop: 4 },
  stepSecondary: { color: colors.inkSoft, ...fonts.body, fontSize: 11 },
  itemsBox: {
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 10,
    marginTop: 2,
    marginBottom: 10,
    gap: 6,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemQty: { color: colors.red, fontSize: 13, ...fonts.bodyHeavy, minWidth: 26 },
  itemName: { color: colors.ink, ...fonts.body, fontSize: 13.5, flex: 1 },
  itemPrice: { color: colors.inkSoft, fontSize: 13, ...fonts.bodySemi },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 12,
    marginTop: 4,
  },
  totalLabel: { color: colors.ink, fontSize: 15, ...fonts.bodyBold },
  totalValue: { color: colors.red, fontSize: 15, ...fonts.bodyHeavy },
  payState: { color: colors.inkSoft, ...fonts.body, fontSize: 12, marginTop: 4 },
  payBtn: {
    marginTop: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.positive,
    paddingVertical: 12,
    alignItems: "center",
  },
  payBtnText: { color: colors.creamCard, ...fonts.bodyHeavy, fontSize: 13 },
  receiptBtn: {
    marginTop: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.red,
    paddingVertical: 12,
    alignItems: "center",
  },
  receiptBtnText: { color: colors.red, ...fonts.bodyBold, fontSize: 13 },
});
