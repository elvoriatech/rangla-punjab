import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import type { GiftCardView } from "../gift-cards";
import type { StaffGiftCardRefusal } from "../staff";
import { lookupStaffGiftCard, redeemStaffGiftCard } from "../staff";
import { GiftCardStatusBadge } from "../gift-card-card";
import { BrandHeader, PrimaryButton } from "../components";
import { fill, localeTag, useI18n } from "../i18n";
import { useLayout, TOUCH_MIN } from "../layout";
import { colors, fonts, money, radius } from "../theme";

/**
 * Taking a gift card at the counter.
 *
 * TYPED, not scanned. `expo-camera` is not a dependency of this build,
 * and adding a native module for one screen would force a rebuild of
 * both binaries — so the screen says so in as many words rather than
 * leaving a cashier hunting for a scan button that was never there. The
 * codes are Crockford base32 (no I, L, O or U) precisely so they survive
 * being read aloud across a dining room and typed one-handed.
 *
 * Two steps, deliberately two requests: LOOK UP, read the value back to
 * the guest, and only then CONFIRM. Redemption is single use, full value
 * and irreversible from the app, so "look" and "spend" are never one
 * tap.
 *
 * Every refusal gets its own sentence. "Expired" and "someone already
 * used it" are not the same conversation, and a generic error turns a
 * ten-second exchange at the till into an argument.
 */

type Stage =
  | { step: "enter" }
  /** The card exists; the cashier is looking at it. */
  | { step: "found"; card: GiftCardView }
  | { step: "done"; card: GiftCardView };

export function RedeemGiftCardScreen({
  onBack,
  onOpenOwnerMenu,
}: {
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const tag = localeTag(lang);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ step: "enter" });

  /** The server's own word for the refusal → the sentence the cashier
   *  says out loud. */
  const refusalText = (reason: StaffGiftCardRefusal | undefined): string => {
    switch (reason) {
      case "unknown":
        return t.giftCardErrUnknown;
      case "not_paid":
        return t.giftCardErrNotPaid;
      case "expired":
        return t.giftCardErrExpired;
      case "already_redeemed":
        return t.giftCardErrRedeemed;
      case "refunded":
        return t.giftCardErrRefunded;
      case "wrong_venue":
        return t.giftCardErrWrongVenue;
      default:
        return t.staffLoadFailed;
    }
  };

  async function lookup(): Promise<void> {
    if (!staffToken || busy || code.trim().length < 4) return;
    setBusy(true);
    setError(null);
    const res = await lookupStaffGiftCard(staffToken, code);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "unauthorized") {
        clearStaff();
        return;
      }
      // 404 is the only refusal the LOOKUP has: a code we never issued.
      setError(res.error === "notfound" ? t.giftCardErrUnknown : t.staffLoadFailed);
      return;
    }
    setStage({ step: "found", card: res.data });
  }

  async function confirm(): Promise<void> {
    if (!staffToken || busy || stage.step !== "found") return;
    setBusy(true);
    setError(null);
    const res = await redeemStaffGiftCard(staffToken, stage.card.code, note);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "unauthorized") {
        clearStaff();
        return;
      }
      setError(refusalText(res.reason));
      return;
    }
    setStage({ step: "done", card: res.data });
  }

  const reset = (): void => {
    setCode("");
    setNote("");
    setError(null);
    setStage({ step: "enter" });
  };

  const expiry = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return fill(t.giftCardExpires, {
      date: d.toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" }),
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.redeemGiftCardTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: layout.pad,
            paddingBottom: 40,
            gap: 12,
            ...layout.content,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {stage.step === "done" ? (
            <>
              <View style={styles.doneBox}>
                <Ionicons name="checkmark-circle" size={44} color={colors.positive} />
                <Text style={styles.doneTitle}>{t.redeemGiftCardDone}</Text>
                <Text style={styles.doneValue}>
                  {money(stage.card.valueCents, stage.card.currency)}
                </Text>
                <Text style={styles.code}>{stage.card.codeFormatted}</Text>
              </View>
              <PrimaryButton label={t.redeemGiftCardAnother} tone="gold" onPress={reset} />
            </>
          ) : (
            <>
              <Text style={styles.lead}>{t.redeemGiftCardLead}</Text>
              {/* Said up front, not after a hunt for a scan button that
                  this build does not contain. */}
              <View style={styles.noticeRow}>
                <Ionicons name="information-circle-outline" size={18} color={colors.gold} />
                <Text style={styles.notice}>{t.redeemGiftCardNoScanner}</Text>
              </View>

              <TextInput
                value={code}
                onChangeText={(next) => {
                  setCode(next);
                  setError(null);
                  // Editing the code retires the card it looked up: a
                  // confirm must never spend something other than what
                  // is on screen.
                  if (stage.step === "found") setStage({ step: "enter" });
                }}
                placeholder={t.redeemGiftCardPlaceholder}
                placeholderTextColor={colors.inkSoft}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={200}
                accessibilityLabel={t.giftCardCodeLabel}
                style={styles.codeInput}
              />

              {stage.step === "enter" ? (
                <PrimaryButton
                  label={t.redeemGiftCardLookup}
                  tone="red"
                  busy={busy}
                  disabled={code.trim().length < 4}
                  onPress={() => void lookup()}
                />
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}

              {stage.step === "found" ? (
                <>
                  <View style={styles.card}>
                    <View style={styles.cardHead}>
                      <View style={{ flex: 1, gap: 2 }}>
                        {stage.card.productName ? (
                          <Text style={styles.product}>{stage.card.productName}</Text>
                        ) : null}
                        <Text style={styles.value}>
                          {money(stage.card.valueCents, stage.card.currency)}
                        </Text>
                      </View>
                      <GiftCardStatusBadge status={stage.card.status} />
                    </View>
                    <Text style={styles.code}>{stage.card.codeFormatted}</Text>
                    {stage.card.recipientName ? (
                      <Text style={styles.meta}>{stage.card.recipientName}</Text>
                    ) : null}
                    {expiry(stage.card.expiresAt) ? (
                      <Text style={styles.meta}>{expiry(stage.card.expiresAt)}</Text>
                    ) : null}
                  </View>

                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder={t.boardNote}
                    placeholderTextColor={colors.inkSoft}
                    maxLength={200}
                    accessibilityLabel={t.boardNote}
                    style={styles.noteInput}
                  />

                  {/* Only a card that is still `active` can be taken. The
                      server re-checks and owns the verdict; showing the
                      button on an expired card would just be a button
                      that fails. */}
                  {stage.card.status === "active" ? (
                    <PrimaryButton
                      label={t.redeemGiftCardConfirm}
                      tone="red"
                      busy={busy}
                      onPress={() => void confirm()}
                    />
                  ) : (
                    <Text style={styles.error}>
                      {stage.card.status === "redeemed"
                        ? t.giftCardErrRedeemed
                        : stage.card.status === "expired"
                          ? t.giftCardErrExpired
                          : stage.card.status === "refunded"
                            ? t.giftCardErrRefunded
                            : t.giftCardErrNotPaid}
                    </Text>
                  )}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const styles = StyleSheet.create({
  lead: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5, lineHeight: 19 },
  noticeRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  notice: { flex: 1, color: colors.gold, ...fonts.bodySemi, fontSize: 12.5, lineHeight: 17 },
  codeInput: {
    backgroundColor: colors.creamCard,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
    color: colors.ink,
    fontFamily: MONO,
    fontSize: 20,
    letterSpacing: 2,
    textAlign: "center",
  },
  noteInput: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: TOUCH_MIN,
    color: colors.ink,
    ...fonts.body,
    fontSize: 15,
  },
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  product: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  value: { color: colors.ink, ...fonts.displayHeavy, fontSize: 26 },
  code: {
    color: colors.ink,
    fontFamily: MONO,
    fontSize: 17,
    letterSpacing: 2,
    textAlign: "center",
  },
  meta: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  error: { color: colors.danger, ...fonts.bodySemi, fontSize: 13.5, lineHeight: 18 },
  doneBox: {
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.creamCard,
    borderWidth: 1.5,
    borderColor: colors.positive,
    borderRadius: radius.lg,
    padding: 20,
  },
  doneTitle: { color: colors.positive, ...fonts.bodyHeavy, fontSize: 18 },
  doneValue: { color: colors.ink, ...fonts.displayHeavy, fontSize: 30 },
});
