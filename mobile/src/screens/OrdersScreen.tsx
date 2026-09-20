import React, { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiTracking } from "../api";
import { fetchOrderStatus } from "../api";
import type { StoredOrder } from "../orders-store";
import { listStoredOrders } from "../orders-store";
import { BrandHeader } from "../components";
import { CHEVRON_FORWARD, colors, fonts, money, radius } from "../theme";
import { fill, localeTag, useI18n } from "../i18n";

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
  /** `issue` asks the tracking view to open the problem thread straight
   *  away, rather than leaving the guest to find the button there. */
  onOpen: (order: StoredOrder, options?: { issue?: boolean }) => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [status, setStatus] = useState<Record<string, ApiTracking>>({});
  /**
   * Orders whose review ask this session has already answered, by id.
   * The tap opens our own tracked redirect, which is what records it
   * server-side and comes back as `review.prompted` on the next lookup
   * — but the CTA has to vanish on the tap, not on the refetch. Never
   * cleared, so a lookup that races the server's write can't bring the
   * ask back onto a card the guest just acted on.
   */
  const [reviewTapped, setReviewTapped] = useState<Record<string, boolean>>({});
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

  /** Icon + one-word status. Unknown statuses (a newer server) fall back
   *  to the server's own step label, so nothing renders blank. */
  const STATUS_ICONS: Record<string, string> = {
    placed: "🕒",
    preparing: "🍳",
    ready: "🛎️",
    done: "✅",
    cancelled: "✖️",
  };
  const statusShort = t.statusShort as Record<string, string>;
  const statusBadge = (s: ApiTracking): { icon: string; text: string } => {
    const short = statusShort[s.status];
    if (short) return { icon: STATUS_ICONS[s.status] ?? "•", text: short };
    const step = s.steps[s.currentStepIndex] ?? s.steps.find((x) => !x.reached);
    return { icon: "•", text: step ? (lang === "de" ? step.labelDe : step.labelEn) : s.status };
  };

  const issueStatusLabels = t.issueStatusLabels as Record<string, string>;

  const METHOD_ICONS: Record<NonNullable<StoredOrder["payment"]>, string> = {
    card: "💳",
    paypal: "🅿️",
    cash: "💶",
  };

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
            // "Cancelled" is terminal but it is NOT "done": the order was
            // never served, so it gets its own muted pill rather than the
            // receipt green (P7-17).
            const cancelled = s?.status === "cancelled" || s?.status === "canceled";
            const done = s?.status === "done" || cancelled;
            const payShort = t.payShort as { paid: string; unpaid: string };
            const methodIcon = order.payment ? METHOD_ICONS[order.payment] : "💶";
            // Paid online → the method's icon + "Paid"; cash or a closed
            // order → settled at the counter; otherwise still open.
            // A reward covered the whole bill: that IS how it was paid,
            // so it replaces the method pill rather than sitting beside it.
            const byReward = s?.paymentProvider === "voucher";
            const pay = byReward
              ? { icon: "🎁", text: t.ordersRewardPill, settled: true }
              : paid || done
                ? { icon: paid ? methodIcon : "💶", text: payShort.paid, settled: true }
                : order.payment === "cash"
                  ? { icon: "💶", text: t.methodCash, settled: false }
                  : order.payment
                    ? { icon: methodIcon, text: payShort.unpaid, settled: false }
                    : null;
            // The reward line shows whatever a reward took off, INCLUDING
            // when it covered the whole bill. It used to be suppressed in
            // that case as a duplicate of the pill, but the pill only says
            // "Reward" — it never says how much, or what it cost in
            // points, which is what the guest is actually owed an answer
            // about.
            const discountCents = s?.discountCents ?? 0;
            const discountPoints = s?.discountPoints ?? 0;
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
                    {/* Number, then both badges on the same line: where the
                        order is, and whether it is paid — each an icon and
                        one word so the row survives a small phone. */}
                    <View style={styles.numberRow}>
                      <Text style={styles.number}>
                        #{String(order.orderNumber).padStart(4, "0")}
                      </Text>
                      {s ? (
                        <View
                          style={[
                            styles.pill,
                            cancelled
                              ? styles.pillCancelled
                              : done
                                ? styles.pillDone
                                : styles.pillActive,
                          ]}
                        >
                          <Text style={styles.pillIcon}>{statusBadge(s).icon}</Text>
                          <Text
                            style={[
                              styles.pillText,
                              cancelled
                                ? styles.pillTextCancelled
                                : done
                                  ? styles.pillTextDone
                                  : styles.pillTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {statusBadge(s).text}
                          </Text>
                        </View>
                      ) : null}
                      {pay ? (
                        <View
                          style={[styles.pill, pay.settled ? styles.pillDone : styles.pillNeutral]}
                        >
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
                      ) : null}
                      {/* A reported problem outlives the order: this pill
                          stays on the card after "done", because that is
                          exactly when the guest goes looking for it. */}
                      {s?.issue ? (
                        <View
                          style={[
                            styles.pill,
                            s.issue.status === "resolved" ? styles.pillNeutral : styles.pillProblem,
                          ]}
                        >
                          <Text style={styles.pillIcon}>⚠️</Text>
                          <Text
                            style={[
                              styles.pillText,
                              s.issue.status === "resolved"
                                ? styles.pillTextNeutral
                                : styles.pillTextProblem,
                            ]}
                            numberOfLines={1}
                          >
                            {t.issuePill} · {issueStatusLabels[s.issue.status] ?? s.issue.status}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {/* Date · type on the left, the amount on the right. */}
                    <View style={styles.metaRow}>
                      <Text style={styles.meta} numberOfLines={1}>
                        {dateFmt(order.placedAt)} · {typeLabel[order.orderType] ?? order.orderType}
                      </Text>
                      <Text style={styles.total}>{money(order.totalCents, order.currency)}</Text>
                    </View>
                    {cancelled ? (
                      <Text style={styles.cancelledNote}>{t.orderCancelledTitle}</Text>
                    ) : null}
                    {discountCents > 0 ? (
                      <Text style={styles.rewardOff}>
                        {fill(discountPoints > 0 ? t.ordersRewardOffPoints : t.ordersRewardOff, {
                          value: money(discountCents, order.currency),
                          points: discountPoints,
                        })}
                      </Text>
                    ) : null}
                    {/* Reporting a problem used to live one tap deeper,
                        on the tracking screen, where a guest had to know
                        to go looking. It is offered here instead —
                        nested inside the card's own Pressable, which
                        resolves to this inner press. */}
                    {/* Same ask as the tracking screen, on the card the
                        guest is already looking at. Done orders only,
                        only when the server offered a link, and only
                        while it is still unanswered — one tap (here or
                        on the tracking screen) retires it. */}
                    {s?.status === "done" &&
                    !cancelled &&
                    s?.review &&
                    !s.review.prompted &&
                    !reviewTapped[order.orderId] ? (
                      <Text
                        onPress={() => {
                          const url = s.review?.url;
                          if (!url) return;
                          setReviewTapped((prev) => ({ ...prev, [order.orderId]: true }));
                          void Linking.openURL(url).catch(() => {});
                        }}
                        suppressHighlighting
                        accessibilityRole="link"
                        accessibilityLabel={t.reviewCta}
                        style={styles.reviewAction}
                      >
                        {t.reviewCta}
                      </Text>
                    ) : null}
                    {s?.issue || s?.canReport ? (
                      <Text
                        onPress={() => onOpen(order, { issue: true })}
                        suppressHighlighting
                        accessibilityRole="button"
                        accessibilityLabel={s?.issue ? t.issueView : t.issueReport}
                        style={styles.reportAction}
                      >
                        {s?.issue ? t.issueView : t.issueReport}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.chev}>{CHEVRON_FORWARD}</Text>
                </View>
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
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  number: { color: colors.ink, fontSize: 17, ...fonts.bodyHeavy },
  meta: { color: colors.inkSoft, ...fonts.body, fontSize: 12, flexShrink: 1 },
  cancelledNote: { color: colors.danger, ...fonts.bodySemi, fontSize: 11.5 },
  // Reward applied but not the payment method: a quiet gold footnote.
  /** The venue's one ask on a finished order: gold, so it reads as an
   *  invitation rather than another status line. */
  reviewAction: {
    color: colors.gold,
    ...fonts.bodyHeavy,
    fontSize: 12.5,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingEnd: 12,
  },
  /** Quiet, but a real target: an underline and a full thumb's height,
   *  never a 12 px trap. */
  reportAction: {
    color: colors.red,
    ...fonts.bodySemi,
    fontSize: 12.5,
    textDecorationLine: "underline",
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingEnd: 12,
  },
  rewardOff: { color: colors.gold, ...fonts.bodySemi, fontSize: 11.5 },
  total: { color: colors.red, fontSize: 16, ...fonts.bodyHeavy },
  chev: { color: colors.inkSoft, ...fonts.body, fontSize: 22, marginStart: 2 },
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
  // Kitchen progress: brand red on the warm tint used for the active chip.
  pillActive: { backgroundColor: "#fdeee6", borderColor: colors.red },
  pillTextActive: { color: colors.red },
  // Settled — served, or paid: the receipt's green.
  pillDone: { backgroundColor: "#e9f3e4", borderColor: "#3f7030" },
  pillTextDone: { color: "#3f7030" },
  // Cash / not paid yet: quiet.
  pillNeutral: { backgroundColor: colors.cream, borderColor: colors.line },
  pillTextNeutral: { color: colors.inkSoft },
  // Cancelled: struck from the day, not completed — never the green one.
  pillCancelled: { backgroundColor: colors.cream, borderColor: colors.danger },
  pillTextCancelled: { color: colors.danger },
  // An unresolved complaint — the one thing on the card that is still
  // waiting on somebody.
  pillProblem: { backgroundColor: "#fdeee6", borderColor: colors.danger },
  pillTextProblem: { color: colors.danger },
});
