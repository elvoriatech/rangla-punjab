import React, { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import type { DispatchRefusal, DispatchedOrder, StaffOrder } from "../staff";
import { dispatchStaffOrder, fetchStaffOrders } from "../staff";
import { BrandHeader, OutlineButton, PrimaryButton } from "../components";
import { useI18n } from "../i18n";
import { useLayout } from "../layout";
import { colors, fonts, radius } from "../theme";

/**
 * "Out for delivery", from the driver's phone.
 *
 * A delivery ticket's QR encodes `https://<site>/dispatch/{orderId}?t=…`.
 * On any phone that opens the web page, which is a complete flow and
 * always will be; on a phone with THIS app and a staff session, the OS
 * hands us the link instead and we do the same thing without the browser
 * round trip. `App.tsx` owns that fork — by the time this screen exists,
 * we already know the user is staff.
 *
 * The confirm is deliberately a tap rather than automatic. Scanning is
 * how a driver gets directions; they may scan a ticket while sorting
 * bags on the pass, minutes before they actually leave, and flipping the
 * guest's tracker to "on the way" on a scan alone would make the app
 * lie. One button, and the button is the promise.
 *
 * `already: true` is a SUCCESS: a second driver sent to the same address,
 * or the same driver scanning twice, sees "on the way" and still gets the
 * route. An error there would just be something to work around.
 */
export function DispatchScreen({
  orderId,
  onBack,
  onOpenOwnerMenu,
}: {
  orderId: string;
  onBack: () => void;
  onOpenOwnerMenu?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const { staffToken, clearStaff } = useAuth();
  const layout = useLayout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DispatchedOrder | null>(null);
  /**
   * What the driver is about to take out, read from the board's own
   * list — the dispatch POST is the only v1 route for this order and it
   * does not answer until it has already moved it, so the number, the
   * name and the address have to come from somewhere that changes
   * nothing.
   *
   * Null is a fine, silent state: an order older than the board's window
   * simply is not in that list, and the button below works regardless.
   * The printed ticket in the driver's hand is the other copy of all
   * three facts.
   */
  const [order, setOrder] = useState<StaffOrder | null>(null);

  useEffect(() => {
    if (!staffToken) return;
    let alive = true;
    void fetchStaffOrders(staffToken).then((res) => {
      if (!alive || !res.ok) return;
      setOrder(res.data.orders.find((o) => o.id === orderId) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [staffToken, orderId]);

  const address = order?.deliveryAddress;
  const addressLine = address
    ? [address.street, [address.zip, address.city].filter(Boolean).join(" ")]
        .filter((part) => part.trim().length > 0)
        .join(", ")
    : "";

  /** The server's own word for the refusal → the sentence a driver
   *  standing by a car can act on. */
  const refusalText = (reason: DispatchRefusal | undefined): string => {
    switch (reason) {
      case "not_found":
        return t.dispatchErrNotFound;
      case "not_delivery":
        return t.dispatchErrNotDelivery;
      case "wrong_state":
        return t.dispatchErrWrongState;
      default:
        return t.staffLoadFailed;
    }
  };

  async function confirm(): Promise<void> {
    if (!staffToken || busy) return;
    setBusy(true);
    setError(null);
    const res = await dispatchStaffOrder(staffToken, orderId);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "unauthorized") {
        clearStaff();
        return;
      }
      setError(refusalText(res.reason));
      return;
    }
    setDone(res.data);
  }

  /**
   * The route, in whichever maps app the phone has.
   *
   * The server hands us a Google Maps https URL, which every platform
   * opens; the native scheme is tried first only on iOS, where Apple
   * Maps is what a driver is most likely to already be signed into.
   * Every failure falls through to the URL we were given.
   */
  async function openRoute(url: string): Promise<void> {
    if (Platform.OS === "ios") {
      const query = /[?&]q=([^&]+)/.exec(url)?.[1] ?? /destination=([^&]+)/.exec(url)?.[1];
      if (query) {
        const opened = await Linking.openURL(`maps://?daddr=${query}`).then(
          () => true,
          () => false,
        );
        if (opened) return;
      }
    }
    await Linking.openURL(url).catch(() => {});
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.dispatchTitle} onBack={onBack} onMenu={onOpenOwnerMenu} />
      <ScrollView
        contentContainerStyle={{
          padding: layout.pad,
          paddingBottom: 40,
          gap: 14,
          ...layout.content,
        }}
      >
        {done ? (
          <>
            <View style={styles.doneBox}>
              <Ionicons name="bicycle" size={44} color={colors.positive} />
              <Text style={styles.doneTitle}>{t.dispatchOnTheWay}</Text>
              <Text style={styles.number}>#{String(done.orderNumber).padStart(4, "0")}</Text>
              {done.customerName ? <Text style={styles.meta}>{done.customerName}</Text> : null}
              {done.addressLine ? <Text style={styles.address}>{done.addressLine}</Text> : null}
              {/* Only when it is news: on a first scan the button above
                  already said what happened. */}
              {done.already ? <Text style={styles.already}>{t.dispatchAlready}</Text> : null}
            </View>
            {done.directionsUrl ? (
              <PrimaryButton
                label={t.dispatchRoute}
                tone="red"
                onPress={() => void openRoute(done.directionsUrl as string)}
              />
            ) : null}
            <OutlineButton icon="arrow-back-outline" label={t.back} onPress={onBack} />
          </>
        ) : (
          <>
            <View style={styles.card}>
              {order ? (
                <>
                  <Text style={styles.number}>#{String(order.orderNumber).padStart(4, "0")}</Text>
                  {order.customerName ? (
                    <Text style={styles.meta}>{order.customerName}</Text>
                  ) : null}
                  {addressLine ? <Text style={styles.addressStart}>{addressLine}</Text> : null}
                  {address?.note ? (
                    <Text style={styles.lead}>
                      {t.boardNote}: {address.note}
                    </Text>
                  ) : null}
                </>
              ) : null}
              <Text style={styles.lead}>{t.dispatchLead}</Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton
              label={t.dispatchConfirm}
              tone="red"
              busy={busy}
              onPress={() => void confirm()}
            />
            <OutlineButton icon="arrow-back-outline" label={t.back} onPress={onBack} />
          </>
        )}
      </ScrollView>
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
    gap: 8,
  },
  lead: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5, lineHeight: 19 },
  number: { color: colors.ink, ...fonts.displayHeavy, fontSize: 26 },
  meta: { color: colors.ink, ...fonts.bodyBold, fontSize: 15 },
  address: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5, textAlign: "center" },
  /** The same line in the pre-confirm card, which is a left-aligned
   *  (reading-edge) block rather than a centred success panel. */
  addressStart: { color: colors.inkSoft, ...fonts.body, fontSize: 14, lineHeight: 19 },
  already: { color: colors.gold, ...fonts.bodySemi, fontSize: 12.5, textAlign: "center" },
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
});
