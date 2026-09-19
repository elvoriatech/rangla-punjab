import React, { useEffect, useMemo, useState } from "react";
import {
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
import { payPageUrl, placeOrder, startHostedPayment } from "../api";
import { confirmFakePayment, openPayPage, payWithCard } from "../payments";
import { useCart } from "../cart";
import { GOOGLE_NATIVE, useAuth } from "../auth";
import { useI18n } from "../i18n";
import { rememberOrder } from "../orders-store";
import { BrandHeader, PrimaryButton, QtyStepper } from "../components";
import { GoogleButton } from "../google-button";
import { colors, fonts, money, radius } from "../theme";

/** How the guest chose to pay, decided BEFORE the order is placed. */
type PayMethod = "card" | "paypal" | "cash";

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
    info: { payment: "card" | "paypal" | "cash"; note?: "cancelled" | "failed"; paid?: boolean },
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
  /** Dev/CI provider only: the order is placed and a fake intent is open,
   *  waiting for the obviously-labelled test button. */
  const [fakePending, setFakePending] = useState<{ order: PlacedOrder; ref: string } | null>(null);

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
    await rememberOrder({
      orderId: result.order.orderId,
      orderNumber: result.order.orderNumber,
      receiptToken: result.order.receiptToken,
      totalCents: result.order.totalCents,
      currency: menu.venue.currency,
      orderType,
      placedAt: new Date().toISOString(),
      payment: payMethod,
    });
    cart.clear();
    const order = result.order;

    if (payMethod === "cash") {
      setBusy(false);
      onPlaced(order, { payment: "cash" });
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
      onPlaced(order, { payment: payMethod, note, paid });
    };

    if (payMethod === "paypal") {
      // PayPal's button lives on our web pay page; the in-app browser
      // closes itself when that page returns to the deep link.
      await openPayPage(payPageUrl(order.orderId, order.receiptToken, deepLink), deepLink);
      done();
      return;
    }

    const outcome = await payWithCard(order.orderId, order.receiptToken, {
      merchantDisplayName: menu.venue.name,
    });
    if (typeof outcome === "object") {
      // Fake provider (dev/CI): no sheet exists, so hand over to the test
      // button rather than pretending the payment went through.
      setPaying(false);
      setBusy(false);
      setFakePending({ order, ref: outcome.fake.ref });
      return;
    }
    if (outcome === "unavailable") {
      // Expo Go, web, or a venue without a publishable key — the hosted
      // checkout page can still take the money.
      const hosted = await startHostedPayment(order.orderId, order.receiptToken);
      const url = hosted.ok ? hosted.url : payPageUrl(order.orderId, order.receiptToken, deepLink);
      await openPayPage(url, deepLink);
      done();
      return;
    }
    // Stripe only reports success once the PaymentIntent succeeded, so
    // the tracking screen can treat the order as paid before the webhook
    // lands, instead of offering to pay a second time.
    if (outcome === "paid") done(undefined, true);
    else done(outcome);
  }

  /** Settles the dev provider's intent. Never reachable against a real
   *  Stripe account — the server only mints fake intents when it has no
   *  live provider configured. */
  async function settleFake(): Promise<void> {
    if (!fakePending || busy) return;
    setBusy(true);
    const { order, ref } = fakePending;
    await confirmFakePayment(order.orderId, order.receiptToken, ref);
    setBusy(false);
    setFakePending(null);
    onPlaced(order, { payment: "card", paid: true });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.cartTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
          {fakePending ? (
            /* Dev/CI only: the basket is already cleared and the order is
               live, so this panel replaces the cart until the test intent
               is settled. Labelled as a test so it can never be mistaken
               for a real payment. */
            <View style={styles.fakeBox}>
              <Text style={styles.emptyTitle}>
                {t.orderNo} #{String(fakePending.order.orderNumber).padStart(4, "0")}
              </Text>
              <Text style={styles.emptySub}>
                {money(fakePending.order.totalCents, menu.venue.currency)}
              </Text>
              <View style={{ alignSelf: "stretch", marginTop: 12 }}>
                <PrimaryButton
                  label={t.simulatePayment}
                  tone="red"
                  busy={busy}
                  onPress={() => void settleFake()}
                />
              </View>
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
                <Row label={t.total} value={money(grandTotal, menu.venue.currency)} bold />
              </View>

              {/* One option = no choice to make; the hint below still says
                  what will happen. */}
              {payOptions.length > 1 ? (
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
                        <Text style={{ ...fonts.body, fontSize: 30 }}>{option.emoji}</Text>
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
                  payMethod === "cash"
                    ? `${t.placeOrder} · ${money(grandTotal, menu.venue.currency)}`
                    : `${t.payNow} ${money(grandTotal, menu.venue.currency)}`
                }
                busyLabel={paying ? t.openingPayment : undefined}
                tone="red"
                onPress={() => void submit()}
                disabled={missing}
                busy={busy}
              />
              <Text style={styles.payNote}>{payHint}</Text>
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
  fakeBox: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
  },
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
  payRow: { flexDirection: "row", gap: 10 },
  payCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 104,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 8,
    backgroundColor: colors.creamCard,
  },
  payCardActive: { borderColor: colors.red, backgroundColor: "#fdeee6" },
  payCardText: { color: colors.inkSoft, fontSize: 15, ...fonts.bodyBold },
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
