import React from "react";
import { Image, Platform, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { GiftCardStatus, GiftCardView } from "./gift-cards";
import { giftCardQrUrl } from "./gift-cards";
import { OutlineButton } from "./components";
import { fill, localeTag, useI18n, type Strings } from "./i18n";
import { colors, fonts, money, radius } from "./theme";
import { TOUCH_MIN } from "./layout";

/**
 * A gift card, as the person holding it sees it: the artwork, the code
 * big enough to read aloud across a counter, the QR, what it is worth,
 * until when — and what has happened to it so far.
 *
 * Shared by the moment after a purchase and by the list in the account,
 * because those are the same card and should not be two designs.
 */

/**
 * The code, in a face where 0 and O, 1 and I cannot be confused.
 *
 * The brand faces are Playfair and Nunito and neither is monospaced;
 * this is the one string in the app that is DICTATED and TYPED rather
 * than read, so it gets the platform's own fixed-width face. (The codes
 * themselves are drawn from Crockford base32, which has already thrown
 * I, L, O and U away — the typeface is the second belt.)
 */
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** Status → the tone it is shown in. Colour is never the only signal:
 *  the badge always carries the word. */
const TONES: Record<string, { fill: string; text: string }> = {
  active: { fill: "#e6f4ea", text: "#1f5c31" },
  pending_payment: { fill: colors.creamCard, text: colors.inkSoft },
  redeemed: { fill: colors.creamCard, text: colors.inkSoft },
  expired: { fill: "#fdeae8", text: "#8a1c15" },
  refunded: { fill: "#fdeae8", text: "#8a1c15" },
};

export function giftCardStatusLabel(status: GiftCardStatus, t: Strings): string {
  switch (status) {
    case "active":
      return t.giftCardStatusActive;
    case "redeemed":
      return t.giftCardStatusRedeemed;
    case "expired":
      return t.giftCardStatusExpired;
    case "refunded":
      return t.giftCardStatusRefunded;
    default:
      // Includes `pending_payment` and anything a newer server invents —
      // "awaiting payment" is the honest reading of a card that is not
      // yet one of the four settled states.
      return t.giftCardStatusPending;
  }
}

export function GiftCardStatusBadge({ status }: { status: GiftCardStatus }): React.ReactElement {
  const { t } = useI18n();
  const tone = TONES[status] ?? TONES.pending_payment!;
  const label = giftCardStatusLabel(status, t);
  return (
    <View style={[styles.badge, { backgroundColor: tone.fill }]} accessibilityRole="text">
      <Text style={[styles.badgeText, { color: tone.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** "12. Sept. 2026" in the guest's language; "" for an unparseable or
 *  absent timestamp, which every caller treats as "no line". */
function longDate(iso: string | null, tag: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Bought → link opened → redeemed.
 *
 * Only the steps that have actually HAPPENED are drawn: a card nobody
 * has forwarded yet shows one dot, not three greyed-out promises. The
 * buyer's question is "did they use it?", and an empty step answers it
 * as clearly as a full one does.
 */
function Timeline({ card }: { card: GiftCardView }): React.ReactElement | null {
  const { t, lang } = useI18n();
  const tag = localeTag(lang);
  const steps: { key: string; label: string; date: string }[] = [];

  const bought = longDate(card.paidAt ?? card.createdAt, tag);
  if (bought) steps.push({ key: "bought", label: t.giftCardTimelineBought, date: bought });

  const shared = longDate(card.sharedAt, tag);
  if (shared) steps.push({ key: "shared", label: t.giftCardTimelineShared, date: shared });

  if (card.redemption) {
    const at = longDate(card.redemption.at, tag);
    const label =
      card.redemption.kind === "order" && card.redemption.orderNumber !== null
        ? fill(t.giftCardTimelineRedeemedOrder, {
            number: String(card.redemption.orderNumber).padStart(4, "0"),
          })
        : t.giftCardTimelineRedeemedCounter;
    steps.push({ key: "redeemed", label, date: at });
  }

  if (steps.length === 0) return null;
  return (
    <View style={styles.timeline}>
      {steps.map((step, i) => (
        <View key={step.key} style={styles.timelineRow}>
          {/* Decorative: the label and the date beside it say everything. */}
          <View style={styles.timelineRail} importantForAccessibility="no-hide-descendants">
            <View style={[styles.timelineDot, i === steps.length - 1 && styles.timelineDotLast]} />
            {i < steps.length - 1 ? <View style={styles.timelineLine} /> : null}
          </View>
          <View style={styles.timelineText}>
            <Text style={styles.timelineLabel}>{step.label}</Text>
            {step.date ? <Text style={styles.timelineDate}>{step.date}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function GiftCardCard({
  card,
  venueName,
}: {
  card: GiftCardView;
  /** Named in the share message, so the person receiving the link knows
   *  which restaurant it is for before they open it. */
  venueName: string;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const tag = localeTag(lang);
  const qr = giftCardQrUrl(card);
  const until = longDate(card.expiresAt, tag);

  const share = async (): Promise<void> => {
    if (!card.shareUrl) return;
    try {
      await Share.share({
        message: fill(t.giftCardShareMessage, { venue: venueName, url: card.shareUrl }),
      });
    } catch {
      // The guest dismissed the sheet, or the platform refused it. There
      // is nothing to report: the card is unchanged either way.
    }
  };

  return (
    <View style={styles.card}>
      {card.imageUrl ? (
        <Image
          source={{ uri: card.imageUrl }}
          style={styles.artwork}
          resizeMode="cover"
          // The design is decoration around a code; the code, the value
          // and the status below are what a screen reader should read.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          {card.productName ? <Text style={styles.product}>{card.productName}</Text> : null}
          <Text style={styles.value}>{money(card.valueCents, card.currency)}</Text>
        </View>
        <GiftCardStatusBadge status={card.status} />
      </View>

      {card.recipientName ? <Text style={styles.recipient}>{card.recipientName}</Text> : null}
      {card.message ? <Text style={styles.message}>{card.message}</Text> : null}

      <Text style={styles.codeLabel}>{t.giftCardCodeLabel}</Text>
      {/* Spoken with spaces between the groups: a screen reader reading
          "ABCD-EFGH-JKMN" as one word is unusable at a counter. */}
      <Text
        style={styles.code}
        selectable
        accessibilityLabel={`${t.giftCardCodeLabel}: ${card.codeFormatted.split("-").join(" ")}`}
      >
        {card.codeFormatted}
      </Text>

      {qr ? (
        <View style={styles.qrWrap}>
          {/* The QR is FETCHED, not rendered: this build has no QR
              library, and adding a native module for one screen would
              force a rebuild of both binaries. The server already draws
              the same PNG for the zero-JS share page. */}
          <Image
            source={{ uri: qr }}
            style={styles.qr}
            resizeMode="contain"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
      ) : null}

      <Text style={styles.hint}>{t.giftCardScanHint}</Text>
      {until ? <Text style={styles.expiry}>{fill(t.giftCardExpires, { date: until })}</Text> : null}

      {card.shareUrl ? (
        <OutlineButton icon="share-outline" label={t.giftCardShare} onPress={() => void share()} />
      ) : null}

      <Timeline card={card} />
    </View>
  );
}

/** One card in a list: enough to recognise it, with the state that
 *  answers "can this still be used?". */
export function GiftCardRow({ card }: { card: GiftCardView }): React.ReactElement {
  const { t, lang } = useI18n();
  const tag = localeTag(lang);
  const until = longDate(card.expiresAt, tag);
  return (
    <View style={styles.row}>
      {card.imageUrl ? (
        <Image
          source={{ uri: card.imageUrl }}
          style={styles.rowThumb}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : (
        <View style={[styles.rowThumb, styles.rowThumbFallback]}>
          <Ionicons name="gift-outline" size={20} color={colors.red} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowValue}>
          {money(card.valueCents, card.currency)}
          {card.productName ? ` · ${card.productName}` : ""}
        </Text>
        <Text style={styles.rowCode}>{card.codeFormatted}</Text>
        {until ? (
          <Text style={styles.rowMeta}>{fill(t.giftCardExpires, { date: until })}</Text>
        ) : null}
      </View>
      <GiftCardStatusBadge status={card.status} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
    overflow: "hidden",
  },
  artwork: { width: "100%", height: 140, borderRadius: radius.md, backgroundColor: colors.line },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  product: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  value: { color: colors.ink, ...fonts.displayHeavy, fontSize: 26 },
  recipient: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  message: { color: colors.inkSoft, ...fonts.body, fontSize: 13, lineHeight: 18 },
  codeLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 11.5, marginTop: 4 },
  code: {
    color: colors.ink,
    fontFamily: MONO,
    fontSize: 24,
    letterSpacing: 2,
    // The one string in the app read aloud across a room: centred, with
    // room around it, so nobody loses their place mid-dictation.
    textAlign: "center",
    paddingVertical: 8,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  qrWrap: { alignItems: "center", paddingVertical: 4 },
  qr: { width: 180, height: 180, backgroundColor: colors.cream, borderRadius: radius.sm },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, lineHeight: 17 },
  expiry: { color: colors.gold, ...fonts.bodySemi, fontSize: 12.5 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { ...fonts.bodyBold, fontSize: 11 },
  timeline: {
    gap: 0,
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineRail: { width: 12, alignItems: "center" },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: colors.line,
  },
  // The newest step is the one that answers "where is this card now".
  timelineDotLast: { backgroundColor: colors.red },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.line },
  timelineText: { flex: 1, paddingBottom: 12, gap: 1 },
  timelineLabel: { color: colors.ink, ...fonts.bodySemi, fontSize: 13 },
  timelineDate: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: TOUCH_MIN,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 12,
  },
  rowThumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.line },
  rowThumbFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
  },
  rowValue: { color: colors.ink, ...fonts.bodyBold, fontSize: 14.5 },
  rowCode: { color: colors.inkSoft, fontFamily: MONO, fontSize: 12.5, letterSpacing: 1 },
  rowMeta: { color: colors.inkSoft, ...fonts.body, fontSize: 11.5 },
});
