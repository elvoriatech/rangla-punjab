import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ExpoLinking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import type { ApiMenu } from "../api";
import { useAuth } from "../auth";
import type { GiftCardProduct, GiftCardShop, GiftCardView } from "../gift-cards";
import {
  buyGiftCard,
  cancelGiftCardPurchase,
  giftCardChargeCents,
  confirmFakeGiftCardPayment,
  fetchGiftCardShop,
  fetchMyGiftCards,
  GIFT_CARD_MAX_CENTS,
  GIFT_CARD_MIN_CENTS,
  GIFT_CARD_STEP_CENTS,
} from "../gift-cards";
import { GiftCardCard } from "../gift-card-card";
import { openPayPage, payIntentWithCard, walletsFromAccepted } from "../payments";
import {
  BrandHeader,
  FieldLabel,
  OutlineButton,
  PrimaryButton,
  RequiredLegend,
} from "../components";
import { fill, useI18n } from "../i18n";
import { useLayout, TOUCH_MIN } from "../layout";
import { usePressScale } from "../motion";
import { colors, fonts, money, radius } from "../theme";
import { displayVenueName } from "../venue-name";

/**
 * Buying a gift card.
 *
 * Three designs, an AMOUNT, a name and a message, and a payment — the
 * same machinery the cart uses, minus the basket. The order of the flow is
 * the same too, and for the same reason: the card is minted FIRST
 * (`pending_payment`) and paid second, so a declined card never loses
 * the guest's message, and an abandoned payment leaves a row nobody can
 * spend rather than a free gift card.
 *
 * The amount is the guest's to choose and is MANDATORY: a design no
 * longer carries a price, only a suggestion (its tile still shows one,
 * and it seeds the field's placeholder). Nothing is pre-filled, because
 * a pre-filled amount is one a guest buys by accident; the Buy button
 * stays disabled until the field holds a whole number of euros inside
 * the venue's bounds. The server re-checks and can still answer
 * `invalid_amount`, which lands on the same message.
 *
 * Signed out, this screen does not grow a sign-in form. The account
 * screen already has one, and a second one would be a second thing to
 * keep working; the nudge points there instead — the same soft gate the
 * cart's "sign in and earn points" line uses.
 */

/** Which sheet to open. There is no cash route: nobody sells a gift card
 *  the guest has not paid for. */
type BuyMethod = "card" | "paypal";

/** Where the purchase has got to. `paid` is the end of the flow — the
 *  card itself takes over the screen. */
type Stage =
  | { step: "form" }
  | { step: "paying"; card: GiftCardView }
  /** Dev/CI provider only: a fake intent waiting for the test button. */
  | { step: "fake"; card: GiftCardView; ref: string }
  | { step: "paid"; card: GiftCardView };

export function GiftCardsScreen({
  menu,
  onBack,
  onOpenAccount,
}: {
  menu: ApiMenu;
  onBack: () => void;
  /** Switches to the Account tab, where signing in actually happens. */
  onOpenAccount: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const auth = useAuth();
  const layout = useLayout();
  const [shop, setShop] = useState<GiftCardShop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  /** The guest typed their own value (no card matches it): neither card
   *  is highlighted, and the card is issued on the first design's art. */
  const [other, setOther] = useState(false);
  const amountRef = useRef<TextInput>(null);
  /** The tile row's measured width: the two cards split it exactly (less
   *  the gap), so they are identical boxes whatever their text is. 0
   *  until measured — natural width for that first frame. */
  const [rowWidth, setRowWidth] = useState(0);
  const tileWidth = rowWidth > 0 ? Math.floor((rowWidth - TILE_GAP) / 2) : undefined;
  /** Whole euros, as TYPED — the string, not a number, so "0" and ""
   *  stay distinguishable and a half-typed "1" is not yet an error. */
  const [amount, setAmount] = useState("");
  /** Set on the first failed submit, so the range message does not
   *  scold a guest who is still typing the first digit. */
  const [amountTouched, setAmountTouched] = useState(false);
  /** The buyer's contact number — REQUIRED (the restaurant must be able
   *  to reach whoever paid). Starts as just the German country code
   *  (owner, 2026-09-21) — never prefilled from the profile, which on a
   *  shared or staff device showed someone else's number. The server
   *  normalises whatever spelling is typed. */
  const [phone, setPhone] = useState("+49 ");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [method, setMethod] = useState<BuyMethod>("card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A calm, non-error line — "Cancelled, nothing was charged". */
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped by every purchase attempt AND by Cancel: a payment step that
   *  finishes after the guest cancelled sees a newer number and does
   *  nothing, so a late sheet result cannot pull the screen back. */
  const attemptRef = useRef(0);
  const [stage, setStage] = useState<Stage>({ step: "form" });

  useEffect(() => {
    let alive = true;
    void fetchGiftCardShop().then((next) => {
      if (!alive) return;
      setShop(next);
      setLoaded(true);
      // Nothing is pre-selected (owner, 2026-09-22): a tap on a card
      // fills its amount in, "Other amount" lets the guest type one, and
      // Buy stays off until one of the two has happened.
    });
    return () => {
      alive = false;
    };
  }, []);

  const product: GiftCardProduct | null =
    shop?.products.find((p) => p.id === productId) ?? shop?.products[0] ?? null;
  const currency = shop?.currency ?? menu.venue.currency;

  // The venue's bounds, with the server's own defaults when it is older
  // than the fields (see `gift-cards.ts`).
  const minCents = shop?.minAmountCents ?? GIFT_CARD_MIN_CENTS;
  const maxCents = shop?.maxAmountCents ?? GIFT_CARD_MAX_CENTS;
  const stepCents = shop?.amountStepCents ?? GIFT_CARD_STEP_CENTS;
  /**
   * The typed euros as cents, or null when the field does not hold a
   * valid amount. `null` is the single thing the button, the error line
   * and the submit all read — there is no second source of truth about
   * whether the form is fillable.
   *
   * Digits only: the field is `number-pad`, but a hardware keyboard on
   * the web build can still type a comma, and "12,50" is not a whole
   * euro. A guest who wants 12,50 € is out of luck by design — the
   * venue's step is whole euros.
   */
  const amountCents: number | null = useMemo(() => {
    const raw = amount.trim();
    if (!/^\d{1,6}$/.test(raw)) return null;
    const cents = Number(raw) * 100;
    if (cents < minCents || cents > maxCents) return null;
    return cents % stepCents === 0 ? cents : null;
  }, [amount, minCents, maxCents, stepCents]);
  /** "5 € – 500 €", in the guest's own money formatting. */
  const rangeHint = fill(t.giftCardAmountHint, {
    min: money(minCents, currency),
    max: money(maxCents, currency),
  });
  /** Empty vs. out-of-range are two different mistakes and get two
   *  different sentences; neither shows before the first submit. */
  const amountError =
    !amountTouched || amountCents !== null
      ? null
      : amount.trim() === ""
        ? t.giftCardAmountMissing
        : fill(t.giftCardAmountRange, {
            min: money(minCents, currency),
            max: money(maxCents, currency),
          });

  /** Loose client check only — enough digits to be a number at all. The
   *  server's `normalizePhone` is the real judge and answers
   *  `invalid_phone` when it disagrees. */
  const phoneOk = phone.replace(/\D/g, "").length >= 6;
  const phoneError =
    !phoneTouched || phoneOk
      ? null
      : phone.trim() === ""
        ? t.giftCardPhoneMissing
        : t.giftCardPhoneInvalid;
  /** Buying is discounted: the guest pays less than the card is worth. */
  const discount = shop?.purchaseDiscountPercent ?? 0;
  const chargeCents = amountCents === null ? null : giftCardChargeCents(amountCents, discount);

  /** Re-read this card from the account, so the screen shows the SERVER's
   *  verdict (status, expiry, share link) rather than the optimistic row
   *  the purchase call answered with. */
  const refreshCard = useCallback(
    async (cardId: string): Promise<GiftCardView | null> => {
      const cards = await fetchMyGiftCards(auth.token);
      return cards.find((c) => c.id === cardId) ?? null;
    },
    [auth.token],
  );

  async function buy(): Promise<void> {
    if (!product || busy || !auth.token) return;
    // The button is disabled without a valid amount, so this is the
    // belt to that brace — and the thing that turns the range message
    // on if a guest somehow reaches it empty.
    if (amountCents === null) {
      setAmountTouched(true);
      return;
    }
    if (!phoneOk) {
      setPhoneTouched(true);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const deepLink = ExpoLinking.createURL("payment-return");
    const result = await buyGiftCard(auth.token, {
      productId: product.id,
      amountCents,
      phone: phone.trim(),
      recipientName: recipient.trim() || undefined,
      message: message.trim() || undefined,
      method,
      ...(method === "paypal" ? { app: deepLink } : {}),
    });
    if (!result.ok) {
      setBusy(false);
      const messages: Record<string, string> = {
        disabled: t.giftCardsDisabled,
        not_available: t.giftCardsDisabled,
        unauthorized: t.giftCardSignIn,
        // The server disagreed with the field. Its bounds are the real
        // ones, so say the same sentence the field says and light the
        // field up with it.
        invalid_amount: fill(t.giftCardAmountRange, {
          min: money(minCents, currency),
          max: money(maxCents, currency),
        }),
        invalid_phone: t.giftCardPhoneInvalid,
      };
      if (result.error === "invalid_amount") setAmountTouched(true);
      if (result.error === "invalid_phone") setPhoneTouched(true);
      setError(messages[result.error] ?? t.giftCardBuyFailed);
      return;
    }
    const card = result.purchase.card;
    const attempt = ++attemptRef.current;
    setStage({ step: "paying", card });

    // PayPal: the server has already started the payment, so the browser
    // opens ON PayPal's approve page and closes itself when the return
    // leg bounces back to the deep link.
    if (result.purchase.paypalUrl) {
      await openPayPage(result.purchase.paypalUrl, deepLink);
      if (attempt !== attemptRef.current) return;
      await settle(card);
      return;
    }

    const payment = result.purchase.payment;
    if (!payment) {
      setBusy(false);
      setStage({ step: "form" });
      setError(t.giftCardBuyFailed);
      return;
    }
    const outcome = await payIntentWithCard(payment, {
      merchantDisplayName: menu.venue.name,
      wallets: walletsFromAccepted(menu.ordering.acceptedPayments),
    });
    if (attempt !== attemptRef.current) return;
    if (typeof outcome === "object") {
      // Dev/CI provider: there is no sheet, so the test button settles it.
      setBusy(false);
      setStage({ step: "fake", card, ref: outcome.fake.ref });
      return;
    }
    if (outcome === "paid") {
      await settle(card);
      return;
    }
    // Cancelled, failed, or no sheet available. The card exists and is
    // unpaid — harmless, unspendable, and the guest can simply buy again.
    setBusy(false);
    setStage({ step: "form" });
    if (outcome !== "cancelled") setError(t.giftCardBuyFailed);
  }

  /**
   * The guest gives up on a stuck payment. The server deletes the unpaid
   * card — unless Stripe says the money DID go through, in which case the
   * card was activated and we show it, like any finished purchase.
   */
  async function cancelPurchase(card: GiftCardView): Promise<void> {
    attemptRef.current += 1;
    setBusy(true);
    const res = await cancelGiftCardPurchase(auth.token, card.id);
    if (!res.ok && res.error === "already_paid") {
      await settle(card);
      return;
    }
    setBusy(false);
    setStage({ step: "form" });
    if (res.ok) {
      setError(null);
      setNotice(t.giftCardCancelled);
    } else {
      setError(res.error === "processing" ? t.cancelOrderProcessing : t.giftCardBuyFailed);
    }
  }

  /** Money has moved: re-read the card and show it. */
  async function settle(card: GiftCardView): Promise<void> {
    const fresh = await refreshCard(card.id);
    setBusy(false);
    setStage({ step: "paid", card: fresh ?? card });
  }

  /** Settles the dev provider's intent. Never reachable against a real
   *  Stripe account — the server refuses the route outright unless the
   *  provider is the fake one. */
  async function settleFake(): Promise<void> {
    if (stage.step !== "fake" || busy) return;
    setBusy(true);
    await confirmFakeGiftCardPayment(auth.token, stage.card.id, stage.ref);
    await settle(stage.card);
  }

  const methods = useMemo<{ key: BuyMethod; label: string }[]>(
    () => [
      ...(menu.ordering.onlinePayment ? [{ key: "card" as const, label: t.methodCard }] : []),
      ...(menu.ordering.paypal ? [{ key: "paypal" as const, label: t.methodPaypal }] : []),
    ],
    [menu.ordering.onlinePayment, menu.ordering.paypal, t],
  );
  // A venue with neither online route cannot sell a card at all; the
  // server would refuse anyway, so say so here rather than at the sheet.
  const payable = methods.length > 0;
  useEffect(() => {
    const first = methods[0];
    if (first && !methods.some((m) => m.key === method)) setMethod(first.key);
  }, [methods, method]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <BrandHeader title={t.giftCardsHeading} onBack={onBack} />
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
          {stage.step === "paid" ? (
            <>
              <Text style={styles.boughtTitle}>{t.giftCardBought}</Text>
              <GiftCardCard card={stage.card} venueName={displayVenueName(menu.venue.name)} />
              <PrimaryButton
                label={t.giftCardsHeading}
                tone="gold"
                onPress={() => {
                  // Straight back to the shop with the message cleared:
                  // the common second act is another card for someone else.
                  setRecipient("");
                  setMessage("");
                  // The amount too: the next card is for someone else,
                  // and it is a mandatory choice, not a sticky setting.
                  setAmount("");
                  setAmountTouched(false);
                  setError(null);
                  setStage({ step: "form" });
                }}
              />
            </>
          ) : !loaded ? (
            <ActivityIndicator color={colors.red} style={{ marginTop: 32 }} />
          ) : !shop || !shop.enabled || !payable ? (
            <Text style={styles.disabled}>{t.giftCardsDisabled}</Text>
          ) : stage.step === "paying" ? (
            <View style={styles.payingBox}>
              <ActivityIndicator color={colors.red} />
              <Text style={styles.payingText}>{t.placingCard}</Text>
              {/* The way out when the payment hangs (a sheet that never
                  answered, a PayPal tab left open). */}
              <OutlineButton
                label={t.giftCardCancelPay}
                onPress={() => void cancelPurchase(stage.card)}
              />
            </View>
          ) : stage.step === "fake" ? (
            <View style={styles.payingBox}>
              {/* Dev/CI provider only, and labelled as a test so it can
                  never be mistaken for a real payment. */}
              <PrimaryButton
                label={t.simulatePayment}
                tone="red"
                busy={busy}
                onPress={() => void settleFake()}
              />
              <OutlineButton
                label={t.giftCardCancelPay}
                onPress={() => void cancelPurchase(stage.card)}
              />
            </View>
          ) : (
            <>
              <Text style={styles.lead}>{t.giftCardsLead}</Text>
              {notice ? <Text style={styles.discount}>{notice}</Text> : null}

              {/* The two designs, side by side. Tapping one fills its value
                  into the amount field; any other value is typed there. */}
              <View
                style={styles.tileRow}
                accessibilityRole="radiogroup"
                onLayout={(e) => setRowWidth(Math.round(e.nativeEvent.layout.width))}
              >
                {shop.products.map((p) => (
                  <ProductTile
                    key={p.id}
                    product={p}
                    currency={currency}
                    discount={discount}
                    width={tileWidth}
                    selected={!other && productId === p.id}
                    onPress={() => {
                      // The card's own value goes straight into the
                      // amount — the guest can still change it below.
                      setProductId(p.id);
                      setOther(false);
                      setAmount(String(Math.round(p.priceCents / 100)));
                      setAmountTouched(false);
                      setError(null);
                    }}
                  />
                ))}
              </View>

              {/* THE AMOUNT — the one required field on this form, so it
                  leads the three and wears the asterisk. The tiles above
                  still print each design's suggested price; this is what
                  the card is actually loaded with. */}
              <View style={{ gap: 6 }}>
                <FieldLabel label={t.giftCardAmount} required style={styles.label} />
                <View style={[styles.amountBox, amountError ? styles.amountBoxError : null]}>
                  <TextInput
                    ref={amountRef}
                    value={amount}
                    onChangeText={(next) => {
                      // Digits only, and capped at six so a fat-fingered
                      // paste cannot grow the field past any sane bound.
                      const digits = next.replace(/[^0-9]/g, "").slice(0, 6);
                      setAmount(digits);
                      setError(null);
                      // Keep the tiles honest about what is in the field:
                      // a card's exact value selects that card, anything
                      // else is the guest's own amount.
                      const match = shop?.products.find(
                        (p) => digits !== "" && p.priceCents === Number(digits) * 100,
                      );
                      if (match) {
                        setProductId(match.id);
                        setOther(false);
                      } else if (digits !== "") {
                        setProductId(null);
                        setOther(true);
                      }
                    }}
                    onBlur={() => setAmountTouched(true)}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    maxLength={6}
                    // The selected design's own price, as the hint of
                    // what this venue considers a normal gift.
                    // No grey "50": the field is filled only by a tap on
                    // a card, or by the guest typing their own amount.
                    placeholderTextColor={colors.inkSoft}
                    // Bold ONLY once there is a real amount in it. The
                    // colour token is the app's placeholder grey and
                    // matches the other two fields on this form, but at
                    // Nunito 800 / 17 the suggestion still read as a
                    // value someone had typed — measured next to the
                    // recipient field's regular 15. Dropping to the
                    // regular face while the field is empty is what
                    // actually makes the two states tell apart.
                    style={[styles.amountInput, amount === "" && styles.amountInputEmpty]}
                    accessibilityLabel={`${t.giftCardAmount}, ${t.fieldRequired}`}
                    accessibilityHint={rangeHint}
                  />
                  {/* The unit belongs to the field, not to what the guest
                      types — so "50" can never be read as 50 cents. */}
                  <Text style={styles.amountUnit}>{currency === "EUR" ? "€" : currency}</Text>
                </View>
                <Text style={styles.hint}>{rangeHint}</Text>
                {/* The purchase discount, once there is a valid amount:
                    the card keeps the full value, the guest pays less. */}
                {chargeCents !== null && discount > 0 ? (
                  <Text style={styles.discount}>
                    {fill(t.giftCardYouPay, {
                      price: money(chargeCents, currency),
                      percent: String(discount),
                    })}
                  </Text>
                ) : null}
                {amountError ? (
                  <Text style={styles.error} accessibilityRole="alert">
                    {amountError}
                  </Text>
                ) : null}
              </View>

              {/* The buyer's contact number — required. */}
              <View style={{ gap: 6 }}>
                <FieldLabel label={t.giftCardPhone} required style={styles.label} />
                <TextInput
                  value={phone}
                  onChangeText={(next) => {
                    setPhone(next);
                    setError(null);
                  }}
                  onBlur={() => setPhoneTouched(true)}
                  keyboardType="phone-pad"
                  inputMode="tel"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  maxLength={32}
                  placeholder="+49 170 1234567"
                  placeholderTextColor={colors.inkSoft}
                  style={[styles.input, phoneError ? styles.amountBoxError : null]}
                  accessibilityLabel={`${t.giftCardPhone}, ${t.fieldRequired}`}
                />
                {phoneError ? (
                  <Text style={styles.error} accessibilityRole="alert">
                    {phoneError}
                  </Text>
                ) : null}
              </View>

              <View style={{ gap: 6 }}>
                <FieldLabel label={t.giftCardRecipient} style={styles.label} />
                <TextInput
                  value={recipient}
                  onChangeText={setRecipient}
                  maxLength={80}
                  style={styles.input}
                  placeholderTextColor={colors.inkSoft}
                  accessibilityLabel={t.giftCardRecipient}
                />
              </View>
              <View style={{ gap: 6 }}>
                <FieldLabel label={t.giftCardMessage} style={styles.label} />
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  maxLength={500}
                  multiline
                  style={[styles.input, styles.messageInput]}
                  placeholderTextColor={colors.inkSoft}
                  accessibilityLabel={t.giftCardMessage}
                />
              </View>

              {methods.length > 1 ? (
                <View style={{ gap: 8, marginTop: 4 }}>
                  <Text style={styles.label}>{t.paymentMethod}</Text>
                  {methods.map((option) => {
                    const selected = method === option.key;
                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => setMethod(option.key)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option.label}
                        style={[styles.payRow, selected && styles.payRowActive]}
                      >
                        <Ionicons
                          name={selected ? "radio-button-on" : "radio-button-off"}
                          size={20}
                          color={selected ? colors.red : colors.inkSoft}
                        />
                        <Text style={[styles.payRowText, selected && { color: colors.red }]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <RequiredLegend />

              {/* The field's own message already sits under the field;
                  don't print it a second time down here. */}
              {error && error !== amountError && error !== phoneError ? (
                <Text style={styles.error}>{error}</Text>
              ) : null}

              {auth.token ? (
                <PrimaryButton
                  // The price on the button is what the guest typed, not
                  // the design's — 0 until they have typed something
                  // valid, at which point the button also stops being
                  // disabled, so the two always agree.
                  label={fill(t.giftCardBuy, {
                    // What the guest is CHARGED — the discounted price.
                    price: money(chargeCents ?? 0, currency),
                  })}
                  tone="red"
                  busy={busy}
                  disabled={!product || amountCents === null || !phoneOk}
                  onPress={() => void buy()}
                />
              ) : (
                /* The soft gate: a card has to land in an account the
                   buyer can come back to, so signing in is genuinely
                   required — but the form for it lives on the Account
                   tab, and duplicating it here would be a second
                   sign-in to keep working. */
                <Pressable
                  onPress={onOpenAccount}
                  accessibilityRole="button"
                  accessibilityLabel={t.giftCardSignIn}
                  style={({ pressed }) => [styles.signIn, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="person-circle-outline" size={20} color={colors.red} />
                  <Text style={styles.signInText}>{t.giftCardSignIn}</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The purchase discount, in the tile's top-left corner. */
function DiscountBadge({ percent }: { percent: number }): React.ReactElement | null {
  const { t } = useI18n();
  if (percent <= 0) return null;
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.badgeText} numberOfLines={1}>
        {fill(t.giftCardDiscountBadge, { percent: String(percent) })}
      </Text>
    </View>
  );
}

function ProductTile({
  product,
  currency,
  discount,
  width,
  selected,
  onPress,
}: {
  product: GiftCardProduct;
  currency: string;
  discount: number;
  width: number | undefined;
  selected: boolean;
  onPress: () => void;
}): React.ReactElement {
  const press = usePressScale(0.96);
  return (
    // The wrapper scales, the Pressable inside takes the touch: a
    // transform on the target itself fights the row's layout.
    <Animated.View style={[press.style, styles.tileCell, width ? { width } : null]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${product.name} · ${money(product.priceCents, currency)}`}
        style={[styles.tile, selected && styles.tileOn]}
      >
        {product.imageUrl ? (
          <Image source={{ uri: product.imageUrl }} style={styles.tileArt} resizeMode="cover" />
        ) : (
          <View style={[styles.tileArt, styles.tileArtFallback]}>
            <Ionicons name="gift-outline" size={28} color={colors.red} />
          </View>
        )}
        <DiscountBadge percent={discount} />
        <Text style={styles.tileName} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.tilePrice}>{money(product.priceCents, currency)}</Text>
      </Pressable>
    </Animated.View>
  );
}

const TILE_GAP = 8;

const styles = StyleSheet.create({
  lead: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5, lineHeight: 19 },
  disabled: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 13.5, marginTop: 24 },
  boughtTitle: { color: colors.ink, ...fonts.display, fontSize: 22 },
  /** `stretch` gives both cards the taller one's height. */
  tileRow: { flexDirection: "row", alignItems: "stretch", gap: TILE_GAP, paddingVertical: 4 },
  /** Sized by the measured row (see `tileWidth`). */
  tileCell: { minWidth: 0 },
  tile: {
    flex: 1,
    backgroundColor: colors.creamCard,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 10,
    gap: 4,
  },
  tileOn: { borderColor: colors.red },
  /** Pinned over the artwork's top-left corner (`start`, so RTL mirrors). */
  badge: {
    position: "absolute",
    top: 13,
    start: 13,
    backgroundColor: colors.red,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: colors.goldSoft,
  },
  badgeText: { color: colors.onRed, ...fonts.bodyHeavy, fontSize: 12 },
  tileArt: { width: "100%", height: 104, borderRadius: radius.md, backgroundColor: colors.line },
  tileArtFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
  },
  tileName: { color: colors.ink, ...fonts.bodyBold, fontSize: 13.5 },
  tilePrice: { color: colors.red, ...fonts.bodyHeavy, fontSize: 15 },
  label: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  hint: { color: colors.inkSoft, ...fonts.body, fontSize: 12 },
  /** The amount field is a ROW — the input plus a fixed unit — so the
   *  box carries the border and the input inside it carries none. */
  amountBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    minHeight: TOUCH_MIN,
  },
  /** Colour is never the only signal here: the sentence under the field
   *  says what is wrong, and the field's own label says it is required. */
  amountBoxError: { borderColor: colors.danger },
  discount: { color: colors.positive, ...fonts.bodySemi, fontSize: 13 },
  amountInput: {
    flex: 1,
    paddingVertical: 10,
    color: colors.ink,
    ...fonts.bodyBold,
    fontSize: 17,
  },
  /** The empty state: the form's ordinary input face, so the suggested
   *  amount reads as a suggestion rather than as an entry. */
  amountInputEmpty: { ...fonts.body, fontSize: 15 },
  amountUnit: { color: colors.inkSoft, ...fonts.bodyBold, fontSize: 15 },
  input: {
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
  messageInput: { minHeight: 90, textAlignVertical: "top" },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: TOUCH_MIN,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  payRowActive: { borderColor: colors.red },
  payRowText: { flex: 1, color: colors.ink, ...fonts.bodySemi, fontSize: 14 },
  error: { color: colors.danger, ...fonts.bodySemi, fontSize: 13 },
  signIn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: TOUCH_MIN,
    borderWidth: 1.5,
    borderColor: colors.red,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  signInText: { color: colors.red, ...fonts.bodyBold, fontSize: 14.5 },
  payingBox: { alignItems: "center", gap: 12, marginTop: 32 },
  payingText: { color: colors.inkSoft, ...fonts.body, fontSize: 13.5 },
});
