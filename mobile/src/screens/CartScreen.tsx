import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ExpoLinking from "expo-linking";
import type { ApiMenu, OrderType, PlacedOrder } from "../api";
import { payPageUrl, placeOrder, setVoucherArmed, startHostedPayment, verifyPayment } from "../api";
import { confirmFakePayment, openPayPage, payWithCard } from "../payments";
import { useCart } from "../cart";
import { GOOGLE_NATIVE, useAuth } from "../auth";
import { fill, useI18n } from "../i18n";
import { armedVoucher, discountFor, useLoyalty } from "../loyalty";
import { rememberOrder } from "../orders-store";
import { BrandHeader, PrimaryButton, QtyStepper } from "../components";
import { GoogleButton } from "../google-button";
import { colors, fonts, money, radius } from "../theme";

/** How the guest chose to pay, decided BEFORE the order is placed. */
type PayMethod = "card" | "paypal" | "cash";

/**
 * Where the checkout has got to after the guest tapped Pay:
 *  - `placing`    — the order is on its way to the server;
 *  - `paying`     — the native Stripe sheet is up;
 *  - `opening`    — the in-app browser has the pay page (PayPal / hosted);
 *  - `confirming` — money taken, we are settling it server-side.
 */
type PlacingStep = "placing" | "paying" | "opening" | "confirming";

type Placing = {
  /** Null only between the tap and the server's answer. */
  order: PlacedOrder | null;
  step: PlacingStep;
  /** Dev/CI provider only: a fake intent waiting for the test button. */
  fake?: { ref: string };
  /** Carried through so every exit can pass it to `onPlaced`. */
  rewardFailed?: boolean;
};

/**
 * The in-flight checkout, mirrored outside React. Switching tabs unmounts
 * this screen while the payment sheet's promise is still pending; the flow
 * itself finishes on `onPlaced` either way, and this is what lets the panel
 * come back — instead of a fully interactive cart that could be ordered a
 * second time — if the guest wanders back here first.
 */
let livePlacing: Placing | null = null;

/**
 * Warenkorb + Kasse — the mockup's cart and checkout as one flow.
 * The server re-prices everything and validates required fields again;
 * this screen's checks exist for a friendly error, not for security.
 *
 * Payment is picked here, not after the fact: the order is still created
 * first (a declined card must not cost the guest their basket), but the
 * button says "Pay" and the sheet opens the moment the order lands.
 */
export function CartScreen({
  menu,
  presetType,
  onPlaced,
}: {
  menu: ApiMenu;
  presetType: OrderType | null;
  onPlaced: (
    order: PlacedOrder,
    info: {
      payment: "card" | "paypal" | "cash";
      note?: "cancelled" | "failed";
      paid?: boolean;
      /** The cart previewed a reward the server then didn't apply. */
      rewardFailed?: boolean;
    },
  ) => void;
}): React.ReactElement {
  const cart = useCart();
  const auth = useAuth();
  const { t } = useI18n();
  const allowed = useMemo(() => {
    const types: { key: OrderType; label: string; emoji: string }[] = [];
    if (menu.ordering.dineIn) types.push({ key: "dine_in", label: t.dineIn, emoji: "🍽️" });
    if (menu.ordering.takeaway) types.push({ key: "takeaway", label: t.pickup, emoji: "🛍️" });
    if (menu.ordering.delivery) types.push({ key: "delivery", label: t.delivery, emoji: "🛵" });
    return types;
  }, [menu.ordering, t]);

  const [orderType, setOrderType] = useState<OrderType>(
    presetType && allowed.some((t) => t.key === presetType)
      ? presetType
      : (allowed[0]?.key ?? "dine_in"),
  );
  const [tableNumber, setTableNumber] = useState("");
  const [requestedTime, setRequestedTime] = useState(""); // "" = ASAP
  const [timeOpen, setTimeOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [zip, setZip] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /** True only while the payment step runs, so the button can say what it
   *  is waiting for instead of spinning anonymously. */
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set the moment the guest taps Pay, cleared only where the flow ends on
   * `onPlaced`. While it is set the cart lines are still there — shown
   * read-only inside the placing panel — so the screen behind the Stripe
   * sheet or the PayPal browser never looks like an emptied basket.
   */
  const [placing, setPlacingState] = useState<Placing | null>(livePlacing);
  const setPlacing = (next: Placing | null): void => {
    livePlacing = next;
    setPlacingState(next);
  };

  // What this venue can actually take. "card" covers the native Stripe
  // sheet AND Google Pay — same intent, the sheet decides which of them
  // the phone can show. Cash is offered when the venue accepts it, and
  // always when there is no online route at all, so the list is never empty.
  const payOptions = useMemo(() => {
    const list: { key: PayMethod; label: string; emoji: string }[] = [];
    if (menu.ordering.onlinePayment) list.push({ key: "card", label: t.methodCard, emoji: "💳" });
    if (menu.ordering.paypal) list.push({ key: "paypal", label: t.methodPaypal, emoji: "🅿️" });
    const cash = (menu.ordering.acceptedPayments ?? []).includes("cash");
    if (cash || list.length === 0) {
      list.push({ key: "cash", label: t.methodCash, emoji: "💶" });
    }
    return list;
  }, [menu.ordering, t]);

  const [payMethod, setPayMethod] = useState<PayMethod>(() =>
    menu.ordering.onlinePayment ? "card" : menu.ordering.paypal ? "paypal" : "cash",
  );
  const payHint =
    payMethod === "card"
      ? t.payHintCard
      : payMethod === "paypal"
        ? t.payHintPaypal
        : t.payAtRestaurant;

  // Restaurant-configured delivery areas: the guest PICKS a postcode and
  // the locality autofills; fee/minimum/free-over come from that row.
  const areas = menu.ordering.deliveryAreas;
  const area = areas.length > 0 ? areas.find((a) => a.zip === zip) : undefined;
  const areaFee = area
    ? (area.freeOverCents ?? 0) > 0 && cart.totalCents >= (area.freeOverCents ?? 0)
      ? 0
      : (area.feeCents ?? 0)
    : menu.ordering.deliveryFeeCents;
  const areaMin = area ? (area.minCents ?? 0) : menu.ordering.deliveryMinCents;
  const deliveryFee = orderType === "delivery" && cart.totalCents > 0 ? areaFee : 0;
  const grandTotal = cart.totalCents + deliveryFee;
  const belowMinimum =
    orderType === "delivery" && areaMin > 0 && cart.totalCents > 0 && cart.totalCents < areaMin;
  // Loyalty is earned on the FOOD subtotal — a delivery fee never buys
  // points. Absent config or a basket below the threshold: no line.
  const loyalty = menu.loyalty;
  const earnsPoints =
    Boolean(loyalty?.enabled) &&
    cart.totalCents > 0 &&
    cart.totalCents >= (loyalty?.minOrderCents ?? 0);

  // The guest's live loyalty state. Null whenever there is no programme,
  // no account or no server support — so everything below collapses to
  // the pre-reward behaviour with no extra conditions.
  const { loyalty: myLoyalty, reload: reloadLoyalty } = useLoyalty(loyalty?.enabled);
  const armed = armedVoucher(myLoyalty);
  /** What the armed reward takes off THIS basket. The server recomputes
   *  it on placement and its number wins; this is the preview. */
  const rewardCents = cart.lines.length > 0 ? discountFor(armed, grandTotal) : 0;
  const chargedTotal = Math.max(0, grandTotal - rewardCents);
  /** The reward swallows the bill: there is nothing left to pay, so the
   *  payment choice is meaningless and must not be offered. */
  const fullyCovered = rewardCents > 0 && chargedTotal === 0;
  const [disarming, setDisarming] = useState(false);

  /** "Not now" — put the reward back in the guest's pocket. The server
   *  owns the flag, so the state is re-read rather than patched here. */
  async function disarmReward(): Promise<void> {
    if (!armed || disarming) return;
    setDisarming(true);
    await setVoucherArmed(auth.token, armed.id, false);
    setDisarming(false);
    reloadLoyalty();
  }
  // Signed-in guests don't retype what the server already knows. Only
  // EMPTY fields are seeded, and only from the profile — anything the
  // guest typed wins, on every re-render and on a later sign-in.
  const customer = auth.customer;
  useEffect(() => {
    if (!customer) return;
    const keep =
      (next: string | null | undefined) =>
      (current: string): string =>
        current || (next ?? "");
    setName(keep(customer.name));
    setPhone(keep(customer.phone));
    setEmail(keep(customer.email));
    const saved = customer.lastDeliveryAddress;
    if (!saved) return;
    setStreet(keep(saved.street));
    setNote(keep(saved.note));
    setZip((current) => {
      if (current) return current;
      const savedZip = saved.zip ?? "";
      // With fixed delivery areas the ZIP is a pick, not free text: a
      // remembered postcode the venue no longer serves must not land in
      // the field and buy an outside_delivery_area rejection.
      if (!savedZip || (areas.length > 0 && !areas.some((a) => a.zip === savedZip))) return current;
      return savedZip;
    });
  }, [customer, areas]);

  /** The one line under the title that says what is being waited on. The
   *  dev test panel says nothing here — its button is the whole message. */
  const placingLine =
    placing == null || placing.step === "placing" || placing.fake
      ? null
      : placing.step === "confirming"
        ? t.placingConfirm
        : payMethod === "paypal"
          ? t.placingPaypal
          : t.placingCard;
  /** Once the server has answered, ITS total is the one to show. */
  const placedTotal = placing?.order ? placing.order.chargedCents : chargedTotal;

  const needsContact = orderType !== "dine_in";
  const missing =
    cart.lines.length === 0 ||
    (needsContact && (!name.trim() || !phone.trim())) ||
    (orderType === "delivery" &&
      (!street.trim() || zip.trim().length < 3 || (areas.length > 0 && !area) || belowMinimum));

  // Same contract as the account screen: native one-tap where the build
  // supports it, the browser device flow everywhere else.
  async function startGoogle(): Promise<void> {
    if (auth.busyProvider) return;
    const outcome = await auth.loginWithGoogle();
    if (outcome === "unavailable") await auth.login("google");
  }

  async function submit(): Promise<void> {
    if (busy) return; // double-tap guard: one in-flight order at a time
    setBusy(true);
    setError(null);
    // The form gives way to the placing panel right now — the basket itself
    // is untouched, so whatever is drawn behind a payment sheet still shows
    // the guest what they ordered.
    setPlacing({ order: null, step: "placing" });
    const result = await placeOrder(
      {
        slug: menu.venue.slug,
        items: cart.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        orderType,
        requestedTime: orderType !== "dine_in" && requestedTime ? requestedTime : undefined,
        tableNumber: orderType === "dine_in" && tableNumber.trim() ? tableNumber.trim() : undefined,
        customerName: needsContact ? name.trim() : undefined,
        customerPhone: needsContact ? phone.trim() : undefined,
        customerEmail: email.trim() || undefined,
        intendedPayment: payMethod,
        // Only ever true when the account really holds an armed voucher —
        // the server checks again and owns the outcome.
        redeemVoucher: rewardCents > 0 ? true : undefined,
        address:
          orderType === "delivery"
            ? {
                street: street.trim(),
                zip: zip.trim(),
                city: area?.locality || undefined,
                note: note.trim() || undefined,
              }
            : undefined,
      },
      auth.token,
    );
    if (!result.ok) {
      setBusy(false);
      setPlacing(null); // nothing was created: back to the editable cart
      const messages: Record<string, string> = {
        ordering_paused: t.orderingPaused,
        outside_delivery_area: t.outsideArea,
        below_delivery_minimum: t.belowMin,
        unknown_items: t.menuChanged,
      };
      setError(messages[result.error] ?? t.orderFailed);
      // Stale ids from a republished menu: re-anchor the cart so the
      // next attempt sends ids the server actually knows.
      if (result.error === "unknown_items") {
        cart.reconcile(menu.categories.flatMap((c) => c.items));
      }
      return;
    }
    const order = result.order;
    // The reward may have expired or been spent elsewhere between the
    // preview and this request. The order still stands — say so once on
    // the tracking screen rather than blocking anything.
    const rewardFailed = rewardCents > 0 && order.discountCents === 0 ? true : undefined;
    await rememberOrder({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      receiptToken: order.receiptToken,
      // What the guest actually pays — the number the history should show.
      totalCents: order.chargedCents,
      currency: menu.venue.currency,
      orderType,
      placedAt: new Date().toISOString(),
      payment: payMethod,
    });
    // NOT cleared here. The cart is emptied only where this flow hands over
    // to the tracking screen, below.
    setPlacing({ order, step: "placing", rewardFailed });

    // The reward covered the whole bill: the order is already paid, so
    // every payment branch below would be asking for €0.00.
    if (order.paidByVoucher) {
      setBusy(false);
      setPlacing(null);
      cart.clear();
      onPlaced(order, { payment: payMethod, paid: true, rewardFailed });
      return;
    }

    if (payMethod === "cash") {
      setBusy(false);
      setPlacing(null);
      cart.clear();
      onPlaced(order, { payment: "cash", rewardFailed });
      return;
    }

    // From here the order EXISTS. Every branch below ends on the tracking
    // screen — a cancelled or failed payment is still a live order the
    // guest can pay again there, or at the counter.
    setPaying(true);
    const deepLink = ExpoLinking.createURL("payment-return");
    const done = (note?: "cancelled" | "failed", paid?: boolean): void => {
      setPaying(false);
      setBusy(false);
      setPlacing(null);
      // The one place an online order's basket is emptied: the payment step
      // is over (paid, cancelled or failed) and the tracking screen takes
      // over from here.
      cart.clear();
      onPlaced(order, { payment: payMethod, note, paid, rewardFailed });
    };

    if (payMethod === "paypal") {
      // PayPal's button lives on our web pay page; the in-app browser
      // closes itself when that page returns to the deep link.
      setPlacing({ order, step: "opening", rewardFailed });
      await openPayPage(payPageUrl(order.orderId, order.receiptToken, deepLink), deepLink);
      done();
      return;
    }

    setPlacing({ order, step: "paying", rewardFailed });
    const outcome = await payWithCard(order.orderId, order.receiptToken, {
      merchantDisplayName: menu.venue.name,
    });
    if (typeof outcome === "object") {
      // Fake provider (dev/CI): no sheet exists, so hand over to the test
      // button rather than pretending the payment went through.
      setPaying(false);
      setBusy(false);
      setPlacing({ order, step: "paying", fake: { ref: outcome.fake.ref }, rewardFailed });
      return;
    }
    if (outcome === "unavailable") {
      // Expo Go, web, or a venue without a publishable key — the hosted
      // checkout page can still take the money.
      setPlacing({ order, step: "opening", rewardFailed });
      const hosted = await startHostedPayment(order.orderId, order.receiptToken);
      const url = hosted.ok ? hosted.url : payPageUrl(order.orderId, order.receiptToken, deepLink);
      await openPayPage(url, deepLink);
      done();
      return;
    }
    // Stripe only reports success once the PaymentIntent succeeded, so
    // the tracking screen can treat the order as paid before the webhook
    // lands, instead of offering to pay a second time.
    if (outcome === "paid") {
      // Settle server-side right away (Stripe lookup), so the tracking
      // screen opens on "Paid" even if the webhook is late or missing.
      setPlacing({ order, step: "confirming", rewardFailed });
      await verifyPayment(order.orderId, order.receiptToken);
      done(undefined, true);
    } else done(outcome);
  }

  /** Settles the dev provider's intent. Never reachable against a real
   *  Stripe account — the server only mints fake intents when it has no
   *  live provider configured. */
  async function settleFake(): Promise<void> {
    const order = placing?.order;
    const ref = placing?.fake?.ref;
    if (!order || !ref || busy) return;
    setBusy(true);
    const rewardFailed = placing?.rewardFailed;
    setPlacing({ order, step: "confirming", rewardFailed });
    await confirmFakePayment(order.orderId, order.receiptToken, ref);
    setBusy(false);
    setPlacing(null);
    cart.clear();
    onPlaced(order, { payment: "card", paid: true, rewardFailed });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.cartTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
          {placing ? (
            /* The order is in flight. Everything interactive is gone —
               no stepper, no fields, no payment cards, no button — but the
               basket is still here, read-only, so the screen behind the
               Stripe sheet or the PayPal browser is recognisably the order
               the guest just placed. */
            <View style={styles.placingBox}>
              <View style={styles.placingHead}>
                <ActivityIndicator color={colors.red} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.placingTitle}>
                    {placing.order
                      ? fill(t.placedTitle, {
                          orderNo: String(placing.order.orderNumber).padStart(4, "0"),
                        })
                      : t.placingTitle}
                  </Text>
                  {placingLine ? <Text style={styles.placingStep}>{placingLine}</Text> : null}
                </View>
              </View>

              <View style={styles.placingSummary}>
                {cart.lines.map((line) => (
                  <Row
                    key={line.itemId}
                    label={`${line.quantity} × ${line.name}`}
                    value={money(line.priceCents * line.quantity, menu.venue.currency)}
                  />
                ))}
                {orderType === "delivery" ? (
                  <Row label={t.deliveryFee} value={money(deliveryFee, menu.venue.currency)} />
                ) : null}
                {rewardCents > 0 ? (
                  <Row
                    label={`★ ${t.rewardsReward}`}
                    value={`−${money(rewardCents, menu.venue.currency)}`}
                  />
                ) : null}
                <Row label={t.total} value={money(placedTotal, menu.venue.currency)} bold />
              </View>

              {/* Dev/CI provider only: no real sheet exists, so the test
                  intent is settled from inside the same panel. Labelled as
                  a test so it can never be mistaken for a real payment. */}
              {placing.fake ? (
                <PrimaryButton
                  label={t.simulatePayment}
                  tone="red"
                  busy={busy}
                  onPress={() => void settleFake()}
                />
              ) : null}

              <Text style={styles.placingHint}>{t.placingHint}</Text>
            </View>
          ) : cart.lines.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ ...fonts.body, fontSize: 40 }}>🛒</Text>
              <Text style={styles.emptyTitle}>{t.cartEmpty}</Text>
              <Text style={styles.emptySub}>{t.cartEmptySub}</Text>
            </View>
          ) : (
            <>
              {cart.lines.map((line) => (
                <View key={line.itemId} style={styles.line}>
                  <Image source={{ uri: line.photoUrl }} style={styles.linePhoto} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text style={styles.linePrice}>
                      {money(line.priceCents, menu.venue.currency)}
                    </Text>
                  </View>
                  <QtyStepper
                    quantity={line.quantity}
                    onChange={(next) => cart.setQuantity(line.itemId, next)}
                  />
                </View>
              ))}

              <View style={styles.typeRow}>
                {allowed.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => setOrderType(t.key)}
                    style={[styles.typeChip, orderType === t.key && styles.typeChipActive]}
                  >
                    <Text style={{ ...fonts.body, fontSize: 18 }}>{t.emoji}</Text>
                    <Text
                      style={[styles.typeChipText, orderType === t.key && { color: colors.red }]}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {orderType === "dine_in" ? (
                <Field
                  label={t.tableOptional}
                  value={tableNumber}
                  onChange={setTableNumber}
                  placeholder={t.tablePlaceholder}
                />
              ) : (
                <>
                  {(menu.ordering.requestSlots ?? []).length > 0 ? (
                    <View style={{ gap: 4 }}>
                      <Text style={styles.fieldLabel}>
                        {orderType === "delivery" ? t.timeDelivery : t.timePickup}
                      </Text>
                      <Pressable style={styles.dropdown} onPress={() => setTimeOpen(true)}>
                        <Text style={styles.dropdownValue}>
                          {requestedTime === "" ? t.asap : requestedTime}
                        </Text>
                        <Text style={styles.dropdownChevron}>▾</Text>
                      </Pressable>
                      <Modal
                        visible={timeOpen}
                        transparent
                        animationType="fade"
                        onRequestClose={() => setTimeOpen(false)}
                      >
                        <Pressable style={styles.modalBackdrop} onPress={() => setTimeOpen(false)}>
                          <View style={styles.modalSheet}>
                            <Text style={styles.modalTitle}>
                              {orderType === "delivery" ? t.timeDelivery : t.timePickup}
                            </Text>
                            <ScrollView style={{ maxHeight: 380 }}>
                              {["", ...(menu.ordering.requestSlots ?? [])].map((slot) => {
                                const selected = requestedTime === slot;
                                return (
                                  <Pressable
                                    key={slot || "asap"}
                                    onPress={() => {
                                      setRequestedTime(slot);
                                      setTimeOpen(false);
                                    }}
                                    style={[
                                      styles.modalOption,
                                      selected && styles.modalOptionActive,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.modalOptionText,
                                        selected && {
                                          color: colors.red,
                                          ...fonts.bodyHeavy,
                                        },
                                      ]}
                                    >
                                      {slot === "" ? t.asap : slot}
                                    </Text>
                                    {selected ? <Text style={{ color: colors.red }}>✓</Text> : null}
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                        </Pressable>
                      </Modal>
                    </View>
                  ) : null}
                  {/* Signed out: one tap fills name, phone, email and
                      the last delivery address. Signed in, it's gone. */}
                  {!auth.customer && auth.googleAvailable ? (
                    <View style={styles.signInNudge}>
                      <Text style={styles.fieldLabel}>{t.signInToPrefill}</Text>
                      <GoogleButton
                        compact
                        label={t.continueWithGoogle}
                        onPress={() => void startGoogle()}
                        busy={auth.busyProvider === GOOGLE_NATIVE}
                      />
                    </View>
                  ) : null}
                  <Field
                    label={t.name}
                    value={name}
                    onChange={setName}
                    placeholder={t.namePlaceholder}
                  />
                  <Field
                    label={t.phone}
                    value={phone}
                    onChange={setPhone}
                    placeholder="+49 …"
                    keyboardType="phone-pad"
                  />
                </>
              )}
              <Field
                label={t.receiptEmail}
                value={email}
                onChange={setEmail}
                placeholder="name@example.com"
                keyboardType="email-address"
                hint={t.receiptEmailHint}
              />
              {orderType === "delivery" ? (
                <>
                  <Field
                    label={t.street}
                    value={street}
                    onChange={setStreet}
                    placeholder="Bahnhofstraße 15"
                  />
                  {areas.length > 0 ? (
                    /* Fixed delivery-area list: the guest PICKS a saved ZIP
                       from a dropdown — free typing would only earn an
                       outside_delivery_area rejection from the server. The
                       locality field beside it fills itself from the pick. */
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ gap: 4, width: 132 }}>
                        <Text style={styles.fieldLabel}>{t.zipLabel}</Text>
                        <Pressable style={styles.dropdown} onPress={() => setZipOpen(true)}>
                          <Text style={styles.dropdownValue}>{zip || "—"}</Text>
                          <Text style={styles.dropdownChevron}>▾</Text>
                        </Pressable>
                      </View>
                      <View style={{ gap: 4, flex: 1 }}>
                        <Text style={styles.fieldLabel}>{t.locality}</Text>
                        <View style={[styles.dropdown, { justifyContent: "flex-start" }]}>
                          <Text
                            style={[
                              styles.dropdownValue,
                              !area?.locality && { color: colors.inkSoft },
                            ]}
                            numberOfLines={1}
                          >
                            {area?.locality || "—"}
                          </Text>
                        </View>
                      </View>
                      <Modal
                        visible={zipOpen}
                        transparent
                        animationType="fade"
                        onRequestClose={() => setZipOpen(false)}
                      >
                        <Pressable style={styles.modalBackdrop} onPress={() => setZipOpen(false)}>
                          <View style={styles.modalSheet}>
                            <Text style={styles.modalTitle}>{t.zipLabel}</Text>
                            <ScrollView style={{ maxHeight: 380 }}>
                              {areas.map((a) => {
                                const selected = zip === a.zip;
                                return (
                                  <Pressable
                                    key={a.zip}
                                    onPress={() => {
                                      setZip(a.zip);
                                      setZipOpen(false);
                                    }}
                                    style={[
                                      styles.modalOption,
                                      selected && styles.modalOptionActive,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.modalOptionText,
                                        selected && {
                                          color: colors.red,
                                          ...fonts.bodyHeavy,
                                        },
                                      ]}
                                    >
                                      {a.zip}
                                      {a.locality ? ` · ${a.locality}` : ""}
                                    </Text>
                                    {selected ? <Text style={{ color: colors.red }}>✓</Text> : null}
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                        </Pressable>
                      </Modal>
                    </View>
                  ) : (
                    <Field
                      label={t.zipLabel}
                      value={zip}
                      onChange={setZip}
                      placeholder="56068"
                      keyboardType="number-pad"
                    />
                  )}
                  <Field
                    label={t.noteOptional}
                    value={note}
                    onChange={setNote}
                    placeholder={t.notePlaceholder}
                  />
                </>
              ) : null}

              <View style={styles.totalBox}>
                <Row label={t.subtotal} value={money(cart.totalCents, menu.venue.currency)} />
                {orderType === "delivery" ? (
                  <Row label={t.deliveryFee} value={money(deliveryFee, menu.venue.currency)} />
                ) : null}
                {/* The armed reward, priced against THIS basket, with the
                    way out right beside it — a guest who'd rather keep it
                    for a bigger order shouldn't have to hunt for the
                    switch on the Account tab. */}
                {rewardCents > 0 ? (
                  <View style={styles.rewardRow}>
                    <View style={styles.rewardLabelWrap}>
                      <Text style={styles.rewardLabel}>★ {t.rewardsReward}</Text>
                      <Pressable
                        onPress={() => void disarmReward()}
                        disabled={disarming}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t.cartRewardNotNow}
                      >
                        <Text style={[styles.rewardNotNow, disarming && { opacity: 0.5 }]}>
                          {t.cartRewardNotNow}
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={styles.rewardValue}>
                      −{money(rewardCents, menu.venue.currency)}
                    </Text>
                  </View>
                ) : null}
                <Row label={t.total} value={money(chargedTotal, menu.venue.currency)} bold />
              </View>

              {/* What this basket is worth in points, said where the
                  guest is already reading the money. Signed out it
                  doubles as the reason to sign in — the Google button
                  itself is already offered above, so this stays one
                  quiet line rather than a second call to action. */}
              {earnsPoints && loyalty ? (
                <Text style={styles.earnLine}>
                  {fill(auth.token ? t.cartEarnPoints : t.cartEarnSignIn, {
                    points: loyalty.pointsPerOrder,
                  })}
                </Text>
              ) : null}

              {/* One option = no choice to make; the hint below still says
                  what will happen. A fully covered order has nothing to
                  charge, so there is no method to pick either. */}
              {payOptions.length > 1 && !fullyCovered ? (
                <View style={{ gap: 6, marginTop: 4 }}>
                  <Text style={styles.fieldLabel}>{t.paymentMethod}</Text>
                  <View style={styles.payRow}>
                    {payOptions.map((option) => (
                      <Pressable
                        key={option.key}
                        onPress={() => setPayMethod(option.key)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: payMethod === option.key }}
                        style={[styles.payCard, payMethod === option.key && styles.payCardActive]}
                      >
                        <Text style={{ ...fonts.body, fontSize: 22 }}>{option.emoji}</Text>
                        <Text
                          style={[
                            styles.payCardText,
                            payMethod === option.key && { color: colors.red },
                          ]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PrimaryButton
                label={
                  fullyCovered
                    ? fill(t.cartPlaceWithReward, {
                        total: money(0, menu.venue.currency),
                      })
                    : payMethod === "cash"
                      ? `${t.placeOrder} · ${money(chargedTotal, menu.venue.currency)}`
                      : `${t.payNow} ${money(chargedTotal, menu.venue.currency)}`
                }
                busyLabel={paying ? t.openingPayment : undefined}
                tone="red"
                onPress={() => void submit()}
                disabled={missing}
                busy={busy}
              />
              <Text style={styles.payNote}>{fullyCovered ? t.payNothingDue : payHint}</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "phone-pad" | "number-pad" | "email-address";
  hint?: string;
}): React.ReactElement {
  const isEmail = keyboardType === "email-address";
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        keyboardType={keyboardType}
        autoCapitalize={isEmail ? "none" : undefined}
        autoCorrect={isEmail ? false : undefined}
        autoComplete={isEmail ? "email" : undefined}
        textContentType={isEmail ? "emailAddress" : undefined}
        style={styles.input}
      />
      {hint ? <Text style={[styles.fieldLabel, { textTransform: "none" }]}>{hint}</Text> : null}
    </View>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 6, paddingVertical: 60 },
  // The in-flight checkout: one cream card, the same hairline and radius as
  // the totals box it stands in for, with the reassurance in gold.
  placingBox: {
    gap: 12,
    padding: 14,
    marginTop: 4,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
  },
  placingHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  placingTitle: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 16 },
  placingStep: { color: colors.inkSoft, ...fonts.body, fontSize: 13, marginTop: 2 },
  placingSummary: { gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  placingHint: { color: colors.gold, ...fonts.bodySemi, fontSize: 12.5, textAlign: "center" },
  emptyTitle: { color: colors.ink, fontSize: 17, ...fonts.bodyBold },
  emptySub: { color: colors.inkSoft, ...fonts.body, fontSize: 13 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 10,
  },
  linePhoto: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.line },
  lineName: { color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  linePrice: { color: colors.red, ...fonts.bodyBold, fontSize: 13, marginTop: 2 },
  typeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  typeChip: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 10,
    backgroundColor: colors.creamCard,
  },
  typeChipActive: { borderColor: colors.red, backgroundColor: "#fdeee6" },
  // Payment choice: the same family as the order-type chips, drawn as
  // proper cards — the guest is choosing how money moves, so it gets the
  // biggest tap target on the screen.
  payRow: { flexDirection: "row", gap: 8 },
  payCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.creamCard,
  },
  payCardActive: { borderColor: colors.red, backgroundColor: "#fdeee6" },
  payCardText: { color: colors.inkSoft, fontSize: 13, ...fonts.bodyBold },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dropdownValue: { color: colors.ink, ...fonts.body, fontSize: 15 },
  dropdownChevron: { color: colors.inkSoft, fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20, 10, 5, 0.45)",
    justifyContent: "center",
    padding: 24,
  },
  modalSheet: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  modalTitle: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: radius.md,
  },
  modalOptionActive: { backgroundColor: "#fdeee6" },
  modalOptionText: { color: colors.ink, ...fonts.body, fontSize: 15 },
  typeChipText: { color: colors.inkSoft, fontSize: 12, ...fonts.bodyBold },
  signInNudge: { gap: 6, marginTop: 2, marginBottom: 2 },
  earnLine: {
    color: colors.gold,
    ...fonts.bodySemi,
    fontSize: 12.5,
    marginTop: 6,
    marginHorizontal: 2,
  },
  fieldLabel: { color: colors.inkSoft, fontSize: 12, ...fonts.bodySemi },
  input: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    ...fonts.body,
    fontSize: 15,
  },
  totalBox: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
    marginTop: 6,
  },
  // The reward line: gold, so it reads as a gift rather than a
  // correction, and never louder than the total underneath it.
  rewardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rewardLabelWrap: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  rewardLabel: { color: colors.gold, ...fonts.bodyBold, fontSize: 14 },
  rewardNotNow: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 12,
    textDecorationLine: "underline",
  },
  rewardValue: { color: colors.gold, ...fonts.bodyHeavy, fontSize: 14 },
  rowLabel: { color: colors.inkSoft, ...fonts.body, fontSize: 14 },
  rowValue: { color: colors.ink, fontSize: 14, ...fonts.bodySemi },
  rowBold: { ...fonts.bodyHeavy, fontSize: 16, color: colors.ink },
  zipInfo: { color: colors.inkSoft, ...fonts.body, fontSize: 12, marginTop: 2 },
  minWarn: { color: colors.danger, fontSize: 12, ...fonts.bodySemi },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, textAlign: "center" },
  payNote: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
  },
});
