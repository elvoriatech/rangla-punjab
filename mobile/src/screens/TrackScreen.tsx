import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ExpoLinking from "expo-linking";
import type { ApiTracking } from "../api";
import {
  fetchOrderStatus,
  payPageUrl,
  receiptUrl,
  startHostedPayment,
  verifyPayment,
} from "../api";
import type { WalletChoice } from "../payments";
import {
  confirmFakePayment,
  openInAppBrowser,
  openPayPage,
  payWithCard,
  payWithPaypal,
} from "../payments";
import { BrandHeader } from "../components";
import { IssueSheet } from "../issue-sheet";
import { CHEVRON_BACK, colors, fonts, money, radius } from "../theme";
import { useI18n } from "../i18n";

/**
 * Bestellung verfolgen — the mockup's tracking screen. Polls the v1
 * status endpoint every 10 s while the order is open; the server's
 * step list is authoritative (the app renders unknown statuses as
 * "in progress" rather than crashing — tolerant-client rule).
 */

/** Statuses nothing ever leaves — polling stops here (P7-17). Spelled
 *  both ways because the server's vocabulary is what arrives, and an
 *  older deployment may still say "canceled". */
function isTerminal(status: string | undefined): boolean {
  return status === "done" || status === "cancelled" || status === "canceled";
}

/** Cancelled is terminal AND out of band: the step rail describes a
 *  journey this order never finished, so it is replaced outright. */
function isCancelled(status: string | undefined): boolean {
  return status === "cancelled" || status === "canceled";
}
export function TrackScreen({
  orderId,
  token,
  merchantName,
  canPayCard,
  canPayPaypal,
  wallets,
  payment,
  paidHint,
  note,
  rewardFailed,
  openIssue,
  onBack,
}: {
  orderId: string;
  token: string;
  /** Shown in the Stripe sheet's header — the venue, not the platform. */
  merchantName: string;
  canPayCard: boolean;
  canPayPaypal: boolean;
  /** Which wallets the restaurant ticked in its settings. Decides
   *  whether the Stripe sheet may show an Apple Pay / Google Pay row at
   *  all — the card row is unaffected. */
  wallets: WalletChoice;
  /** Set when the guest just came from the cart with an unfinished
   *  payment; shown once, above the pay buttons. */
  note?: "cancelled" | "failed";
  /** How the guest chose to pay at checkout, when this device knows. A
   *  cash order never gets online pay buttons — the guest decided. */
  payment?: "card" | "paypal" | "cash";
  /** The Stripe sheet reported success just now: render "paid" at once
   *  and poll quickly until the webhook has settled the order. */
  paidHint?: boolean;
  /** The cart previewed a reward this order didn't get (expired, or
   *  already spent). One line, no action — the order itself is fine. */
  rewardFailed?: boolean;
  /** The guest asked for the problem thread from the orders list, so it
   *  opens with the screen instead of waiting to be found on it. */
  openIssue?: boolean;
  onBack: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  /** Step-rail wording in the guest's own language, keyed on the stable
   *  `key` the status route ships alongside its German/English pair. */
  const stepShort = t.statusShort as Record<string, string>;
  const [tracking, setTracking] = useState<ApiTracking | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Dev/CI provider: an open fake intent waiting for the test button. */
  const [fakeRef, setFakeRef] = useState<string | null>(null);
  /** Client-side proof of payment (sheet success), ahead of the webhook. */
  const [confirmed, setConfirmed] = useState(Boolean(paidHint));
  /** The complaint thread, when the guest opens it. */
  // Opened straight away when the guest asked for the thread from the
  // orders list rather than from this screen's own button.
  const [issueOpen, setIssueOpen] = useState(Boolean(openIssue));
  /** The thread's status, kept in step with the sheet so the button's
   *  label and pill don't wait for the next status poll. */
  const [issueStatus, setIssueStatus] = useState<string | null>(null);
  /**
   * The guest has tapped "Rate us on Google" in this session. The tap's
   * own request to our redirect is what actually records it, and the
   * next poll brings `review.prompted: true` back — but the ask has to
   * be gone the instant it is answered, not ten seconds later. Sticky
   * on purpose: it is never cleared, so a poll that races the server's
   * own write cannot make the CTA flicker back into view.
   */
  const [reviewTapped, setReviewTapped] = useState(false);
  const confirmedRef = useRef(confirmed);
  confirmedRef.current = confirmed;
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // After a confirmed sheet, ask the server to verify with Stripe before
    // each status read (a handful of times — the order rate limit is
    // shared with placing orders), so a missing webhook cannot leave the
    // guest on "confirming…".
    let verifies = 0;
    async function load(): Promise<void> {
      if (timer) clearTimeout(timer);
      try {
        if (confirmedRef.current && verifies < 6) {
          verifies += 1;
          await verifyPayment(orderId, token);
        }
        const next = await fetchOrderStatus(orderId, token);
        if (!alive) return;
        setTracking(next);
        // A thread is never un-created: keep what the sheet already knows
        // rather than flashing back to "no thread" on a poll that raced
        // the guest's first message.
        setIssueStatus((prev) => next.issue?.status ?? prev);
        setError(false);
        // Waiting on the webhook after a confirmed payment: poll fast so
        // "Paid" settles within seconds, not at the next 10 s tick.
        if (next.paymentStatus === "paid") verifies = 6;
        const wait = confirmedRef.current && next.paymentStatus !== "paid" ? 3_000 : 10_000;
        // A cancelled order is as finished as a done one — there is
        // nothing left for a poll to learn, so the loop ends here too.
        if (!isTerminal(next.status)) timer = setTimeout(() => void load(), wait);
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

  // The cart's note is a one-off explanation of how the guest got here,
  // not a state of the order — it goes away as soon as they try again.
  const [banner, setBanner] = useState<"cancelled" | "failed" | null>(note ?? null);

  const deepLink = ExpoLinking.createURL("payment-return");

  async function startCard(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    const outcome = await payWithCard(orderId, token, {
      merchantDisplayName: merchantName,
      wallets,
    });
    if (typeof outcome === "object") {
      setFakeRef(outcome.fake.ref);
      setBusy(false);
      return;
    }
    if (outcome === "unavailable") {
      const hosted = await startHostedPayment(orderId, token);
      await openPayPage(
        hosted.ok ? hosted.url : payPageUrl(orderId, token, deepLink, lang),
        deepLink,
      );
    } else if (outcome === "paid") {
      setConfirmed(true);
    } else if (outcome === "cancelled" || outcome === "failed") {
      setBanner(outcome);
    }
    setBusy(false);
    // The sheet resolved or the browser tab closed — read the truth from
    // the server rather than trusting the client's own outcome.
    reloadRef.current();
  }

  async function startPaypal(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    // One tap: the server hands back PayPal's approve URL and the
    // browser both opens on it and closes itself on the way back.
    await payWithPaypal(orderId, token, lang);
    setBusy(false);
    reloadRef.current();
  }

  async function settleFake(): Promise<void> {
    if (busy || !fakeRef) return;
    setBusy(true);
    await confirmFakePayment(orderId, token, fakeRef);
    setFakeRef(null);
    setConfirmed(true);
    setBusy(false);
    reloadRef.current();
  }

  // Terminal statuses: the guest has eaten (or the order was cancelled), so
  // an unpaid online record means it was settled at the counter.
  const closed = isTerminal(tracking?.status);
  const cancelled = isCancelled(tracking?.status);
  // A reward covered this order outright: there is nothing to pay, ever,
  // so the pay buttons stay away even before the status poll catches up.
  const paidByReward = tracking?.paymentProvider === "voucher";
  const discountCents = tracking?.discountCents ?? 0;

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
            <Text style={[styles.confirmed, cancelled && styles.confirmedCancelled]}>
              {cancelled
                ? t.orderCancelledTitle
                : tracking.status === "done"
                  ? t.orderDone
                  : t.orderConfirmed}
            </Text>
            <Text style={styles.orderNo}>
              {t.orderNo} #{String(tracking.orderNumber).padStart(4, "0")}
            </Text>
            {tracking.tableNumber ? (
              <Text style={styles.meta}>
                {t.table} {tracking.tableNumber}
              </Text>
            ) : null}

            {cancelled ? (
              // The one thing the guest needs from this screen now: it
              // stopped, and what happens to money they already paid.
              <View style={styles.cancelledBanner} accessibilityRole="alert">
                <Text style={styles.cancelledTitle}>{t.orderCancelledTitle}</Text>
                <Text style={styles.cancelledBody}>{t.orderCancelledBody}</Text>
              </View>
            ) : (
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
                          labels, but it also ships a stable `key` — and
                          this app has that key in all six languages. So
                          the rail is worded HERE, exactly as the Orders
                          list already does it, and the server's pair is
                          only the fallback for a key this build has never
                          heard of. The German/English subtitle survives
                          for those two languages alone: a French guest
                          gains nothing from a German second line. */}
                        <Text style={[styles.stepPrimary, !step.reached && { opacity: 0.5 }]}>
                          {stepShort[step.key] ?? (lang === "de" ? step.labelDe : step.labelEn)}
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
            )}

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

            {/* What the reward took off, above the total it produced —
                the guest sees the subtraction, not just a smaller number. */}
            {discountCents > 0 ? (
              <View style={styles.rewardRow}>
                <Text style={styles.rewardLabel}>★ {t.rewardsReward}</Text>
                <Text style={styles.rewardValue}>−{money(discountCents, tracking.currency)}</Text>
              </View>
            ) : null}
            <View style={[styles.totalRow, discountCents > 0 && styles.totalRowAfterReward]}>
              <Text style={styles.totalLabel}>{t.total}</Text>
              <Text style={styles.totalValue}>{money(tracking.totalCents, tracking.currency)}</Text>
            </View>
            {/* A cancelled order that was never paid owes no payment
                line at all: "settled at the counter" would be a story
                about a meal that never happened. One that WAS paid keeps
                its line — that money is the guest's refund. */}
            {cancelled && tracking.paymentStatus !== "paid" && !paidByReward ? null : (
              <Text style={styles.payState}>
                {paidByReward
                  ? t.paidWithReward
                  : tracking.paymentStatus === "paid"
                    ? t.paidOnline
                    : confirmed
                      ? t.payConfirming
                      : closed
                        ? t.paidAtRest
                        : payment === "cash" ||
                            (payment === undefined && !canPayCard && !canPayPaypal)
                          ? t.payAtRest
                          : t.payNotYet}
              </Text>
            )}
            {rewardFailed ? <Text style={styles.rewardFailed}>{t.trackRewardFailed}</Text> : null}

            {/* Settled (server, sheet or reward), chosen cash, or the
                kitchen has closed the order: nothing left to pay. */}
            {tracking.paymentStatus !== "paid" &&
            !confirmed &&
            !paidByReward &&
            payment !== "cash" &&
            !closed ? (
              <>
                {banner ? (
                  <Text style={styles.payBanner}>
                    {banner === "cancelled" ? t.payCancelledNote : t.payFailedNote}
                  </Text>
                ) : null}
                {fakeRef ? (
                  <Pressable
                    onPress={() => void settleFake()}
                    disabled={busy}
                    style={[styles.payBtn, busy && { opacity: 0.6 }]}
                  >
                    <Text style={styles.payBtnText}>{t.simulatePayment}</Text>
                  </Pressable>
                ) : (
                  <>
                    {canPayCard ? (
                      <Pressable
                        onPress={() => void startCard()}
                        disabled={busy}
                        style={[styles.payBtn, busy && { opacity: 0.6 }]}
                      >
                        <Text style={styles.payBtnText}>{t.payWithCard}</Text>
                      </Pressable>
                    ) : null}
                    {canPayPaypal ? (
                      <Pressable
                        onPress={() => void startPaypal()}
                        disabled={busy}
                        style={[styles.payBtn, busy && { opacity: 0.6 }]}
                      >
                        <Text style={styles.payBtnText}>{t.payWithPaypal}</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </>
            ) : null}
            <Pressable
              onPress={() => void openInAppBrowser(receiptUrl(orderId, token, lang))}
              style={styles.receiptBtn}
            >
              <Text style={styles.receiptBtnText}>{t.receiptPdf}</Text>
            </Pressable>

            {/* The ask, once the meal has actually happened. Only ever
                on a DONE order — a cancelled one has nothing to review —
                and only when the server sent a link, which it does only
                for a venue that set a Place ID and left its rating on.
                Asked ONCE: `prompted` (or this session's own tap) retires
                it for good, because a guest who has already reviewed is
                being nagged, not invited. */}
            {tracking.status === "done" &&
            !cancelled &&
            tracking.review &&
            !tracking.review.prompted &&
            !reviewTapped ? (
              <Pressable
                onPress={() => {
                  const url = tracking.review?.url;
                  if (!url) return;
                  // Mark it answered FIRST: the link is our own tracked
                  // redirect, so the open is what records the tap, and
                  // the guest should not come back to an ask they have
                  // already acted on.
                  setReviewTapped(true);
                  void Linking.openURL(url).catch(() => {});
                }}
                accessibilityRole="link"
                accessibilityLabel={t.reviewCta}
                style={({ pressed }) => [styles.reviewBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.reviewBtnText}>{t.reviewCta}</Text>
                <Text style={styles.reviewBtnSub}>{t.reviewCtaSub}</Text>
              </Pressable>
            ) : null}

            {/* Something went wrong with the order itself. Offered while
                the venue's reporting window is open, and for as long as a
                thread exists — an answered complaint has to stay
                reachable long after the window has closed. */}
            {issueStatus || tracking.canReport ? (
              <Pressable
                onPress={() => setIssueOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={issueStatus ? t.issueView : t.issueReport}
                style={({ pressed }) => [styles.issueBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.issueBtnText}>{issueStatus ? t.issueView : t.issueReport}</Text>
                {issueStatus ? (
                  <Text style={styles.issueBtnStatus}>
                    {(t.issueStatusLabels as Record<string, string>)[issueStatus] ?? issueStatus}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>

      <IssueSheet
        target={issueOpen ? { mode: "guest", orderId, token } : null}
        onClose={() => setIssueOpen(false)}
        onChanged={setIssueStatus}
      />
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
  confirmedCancelled: { color: colors.danger },
  cancelledBanner: {
    marginTop: 18,
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: radius.md,
    backgroundColor: "#fdeee6",
    padding: 14,
    gap: 4,
  },
  cancelledTitle: { color: colors.danger, fontSize: 15, ...fonts.bodyHeavy },
  cancelledBody: { color: colors.ink, ...fonts.body, fontSize: 13, lineHeight: 19 },
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
  rewardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 12,
    marginTop: 4,
  },
  /** The reward row already drew the rule above the money block. */
  totalRowAfterReward: { borderTopWidth: 0, paddingTop: 6, marginTop: 0 },
  rewardLabel: { color: colors.gold, fontSize: 14, ...fonts.bodyBold },
  rewardValue: { color: colors.gold, fontSize: 14, ...fonts.bodyHeavy },
  rewardFailed: { color: colors.danger, ...fonts.bodySemi, fontSize: 12, marginTop: 6 },
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
  payBanner: {
    marginTop: 12,
    backgroundColor: "#fdeee6",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 10,
    color: colors.ink,
    ...fonts.bodySemi,
    fontSize: 12.5,
  },
  receiptBtn: {
    marginTop: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.red,
    paddingVertical: 12,
    alignItems: "center",
  },
  receiptBtnText: { color: colors.red, ...fonts.bodyBold, fontSize: 13 },
  // Quieter than the receipt button on purpose: reporting a problem must
  // be findable, not the thing the screen pushes you toward.
  /** Gold, because this is the one thing on a finished order the venue
   *  is actually asking for — and gold is the brand's "look here". */
  reviewBtn: {
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
    backgroundColor: colors.creamCard,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: "center",
    gap: 2,
  },
  reviewBtnText: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 14.5 },
  reviewBtnSub: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  issueBtn: {
    marginTop: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cream,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  issueBtnText: { color: colors.ink, ...fonts.bodyBold, fontSize: 13 },
  issueBtnStatus: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11 },
});
