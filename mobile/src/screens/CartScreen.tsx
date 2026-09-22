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
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import type { ApiMenu, OrderType, PlacedOrder } from "../api";
import { payPageUrl, placeOrder, setVoucherArmed, startHostedPayment, verifyPayment } from "../api";
import type { PlatformPayButtonProps } from "../stripe-module";
import {
  confirmFakePayment,
  isPlatformPayAvailable,
  openPayPage,
  payWithCard,
  payWithPaypal,
  payWithPlatformPay,
  platformPayButton,
  walletsFromAccepted,
} from "../payments";
import { useCart } from "../cart";
import { GOOGLE_NATIVE, useAuth } from "../auth";
import { fill, useI18n } from "../i18n";
import { useVenueOpenNow, venueTimezone } from "../hours";
import { armedVoucher, discountFor, pointsForFood, useLoyalty } from "../loyalty";
import type { GiftCardView } from "../gift-cards";
import { fetchMyGiftCards, giftCardLast4, isSpendable, normalizeGiftCardCode } from "../gift-cards";
import { rememberOrder } from "../orders-store";
import { BrandHeader, FieldLabel, PrimaryButton, QtyStepper, RequiredLegend } from "../components";
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
  /** How THIS attempt is being paid — the panel's copy follows the button
   *  that was pressed, not whatever the radio list says afterwards. */
  method: PayMethod;
  /** The native wallet (Apple Pay / Google Pay) rather than the sheet. */
  wallet?: boolean;
  /** Dev/CI provider only: a fake intent waiting for the test button. */
  fake?: { ref: string };
  /** Carried through so every exit can pass it to `onPlaced`. */
  rewardFailed?: boolean;
  /** The cart applied a gift card the server didn't end up honouring. */
  giftCardFailed?: boolean;
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
      /** Same for a gift card: the code was sent, nothing came off. */
      giftCardFailed?: boolean;
    },
  ) => void;
}): React.ReactElement {
  const cart = useCart();
  const auth = useAuth();
  const { t, lang } = useI18n();
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
  const [zipOpen, setZipOpen] = useState(false);
  /** The guest asked to edit a delivery address the app had already
   *  filled in. Sticky for the session: once the fields are open they
   *  stay open, so a half-typed change can't be swallowed by a re-render. */
  const [editingAddress, setEditingAddress] = useState(false);
  /** The guest has typed in the address fields themselves. The card is a
   *  summary of what the PROFILE knew, so the moment a guest writes their
   *  own address the fields are theirs and must stay open — including the
   *  case where the profile arrives mid-typing. */
  const [addressTouched, setAddressTouched] = useState(false);
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
  // sheet and — only for the wallets the venue ticked in its settings —
  // the wallet rows inside it. Cash is offered when the venue accepts it, and
  // always when there is no online route at all, so the list is never empty.
  const payOptions = useMemo(() => {
    const list: { key: PayMethod; label: string }[] = [];
    if (menu.ordering.onlinePayment) list.push({ key: "card", label: t.methodCard });
    if (menu.ordering.paypal) list.push({ key: "paypal", label: t.methodPaypal });
    const cash = (menu.ordering.acceptedPayments ?? []).includes("cash");
    if (cash || list.length === 0) {
      list.push({ key: "cash", label: t.methodCash });
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

  /**
   * Apple Pay / Google Pay, as a button of their own above the list
   * (P7-13) — but only when there is genuinely one to draw. `null` here
   * means nothing renders at all, which is the DEFAULT state:
   *
   *  - web / Expo Go: no native Stripe module;
   *  - iOS without the ⛔ `APPLE_MERCHANT_ID` build var: no entitlement;
   *  - a device with no wallet set up, or an Android that has not yet
   *    initialised Stripe (it needs a publishable key, which only arrives
   *    with a PaymentIntent);
   *  - a venue that doesn't take card online;
   *  - a venue that did not tick THIS platform's wallet in its settings.
   *
   * The probe runs once per mount and the button appears only on a
   * definite yes.
   */
  const wallets = useMemo(
    () => walletsFromAccepted(menu.ordering.acceptedPayments),
    [menu.ordering.acceptedPayments],
  );
  const [PlatformPay, setPlatformPay] =
    useState<React.ComponentType<PlatformPayButtonProps> | null>(null);
  useEffect(() => {
    if (!menu.ordering.onlinePayment) return;
    if (!wallets.applePay && !wallets.googlePay) return;
    let alive = true;
    void isPlatformPayAvailable(wallets).then((supported) => {
      if (!alive || !supported) return;
      setPlatformPay(() => platformPayButton());
    });
    return () => {
      alive = false;
    };
  }, [menu.ordering.onlinePayment, wallets]);

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
  const earnedPoints = loyalty?.enabled ? pointsForFood(loyalty, cart.totalCents) : 0;
  const earnsPoints = earnedPoints > 0;

  // The guest's live loyalty state. Null whenever there is no programme,
  // no account or no server support — so everything below collapses to
  // the pre-reward behaviour with no extra conditions.
  const { loyalty: myLoyalty, reload: reloadLoyalty } = useLoyalty(loyalty?.enabled);
  const armed = armedVoucher(myLoyalty);
  /** What the armed reward takes off THIS basket. The server recomputes
   *  it on placement and its number wins; this is the preview. */
  const rewardCents = cart.lines.length > 0 ? discountFor(armed, grandTotal) : 0;
  /** What is still owed once the reward has been spent. The SERVER
   *  applies the reward first and lets the gift card cover the
   *  remainder, so this — not the basket total — is what a card is
   *  measured against. */
  const afterReward = Math.max(0, grandTotal - rewardCents);

  /* ── Gift cards ──────────────────────────────────────────────────
   *
   * A gift card is a BEARER instrument: the code is the value, so any
   * code the guest can produce is spendable here — including one
   * somebody else bought and forwarded them. What the account can
   * offer as a LIST is only the cards this guest paid for, which is
   * why typing a code is a first-class option beside the picker
   * rather than a fallback.
   *
   * The entry point appears only for a signed-in guest who holds at
   * least one active card. A guest with none has nothing to pick and
   * no reason to believe a code field would work; the place to learn
   * about gift cards is the Home screen's own entry.
   */
  const [myCards, setMyCards] = useState<GiftCardView[]>([]);
  useEffect(() => {
    if (!auth.token) {
      setMyCards([]);
      return;
    }
    let alive = true;
    void fetchMyGiftCards(auth.token).then((cards) => {
      if (alive) setMyCards(cards.filter(isSpendable));
    });
    return () => {
      alive = false;
    };
  }, [auth.token]);

  /** The picker/field panel is open. */
  const [giftOpen, setGiftOpen] = useState(false);
  /** The code that will actually be sent, "" when none. */
  const [giftCode, setGiftCode] = useState("");
  /** What the guest is typing, before Apply. */
  const [giftTyped, setGiftTyped] = useState("");
  /** The forfeit box has been ticked FOR THE CURRENT SITUATION. Cleared
   *  whenever the card or the basket changes, because an agreement to
   *  lose €12 is not an agreement to lose €40. */
  const [forfeitOk, setForfeitOk] = useState(false);

  /** The applied card, when it is one of the guest's own — which is the
   *  only case where the app knows what it is worth. A forwarded code
   *  has no value we may look up (a public code lookup would be an
   *  oracle for walking the code space), so the server stays the sole
   *  authority for those. */
  const appliedCard =
    giftCode === ""
      ? null
      : (myCards.find((c) => c.code === normalizeGiftCardCode(giftCode)) ?? null);
  const giftValueKnown = appliedCard !== null;
  /** The preview. 0 for a code whose value we cannot see — we never
   *  show a discount we have not been told about. */
  const giftCents = appliedCard ? Math.min(appliedCard.valueCents, afterReward) : 0;

  const chargedTotal = Math.max(0, afterReward - giftCents);
  /** The reward alone swallows the bill. */
  const coveredByReward = rewardCents > 0 && afterReward === 0;
  /** The card finishes the bill off — the order is settled on placement
   *  and no payment sheet may open. */
  const coveredByGiftCard = !coveredByReward && giftCents > 0 && chargedTotal === 0;
  /** Nothing left to pay, whichever of the two did it: the payment
   *  choice is meaningless and must not be offered. */
  const fullyCovered = coveredByReward || coveredByGiftCard;

  /**
   * THE FORFEIT RULE. A gift card is single use, FULL VALUE: spending a
   * €50 card on a €18 order destroys the other €32. That is the one
   * thing about this feature a guest can genuinely lose money to, so it
   * is never implied and never silent — the warning is shown and the
   * order is blocked until the guest ticks the box in so many words.
   *
   * Two cases need it:
   *  - a card we can price, worth more than what is left to pay; and
   *  - a code we CANNOT price (someone else's card). We have no way to
   *    know it isn't a €100 card against a €12 basket, and "we couldn't
   *    tell" is not a reason to let the money go quietly — so the tick
   *    is required there too, with the checkbox's own words carrying the
   *    rule since there are no numbers to put in the sentence.
   */
  const forfeitCents = appliedCard ? Math.max(0, appliedCard.valueCents - afterReward) : 0;
  const forfeitNeeded = giftCode !== "" && (!giftValueKnown || forfeitCents > 0);
  const [disarming, setDisarming] = useState(false);

  /** Take the card back off the order. */
  const clearGiftCard = (): void => {
    setGiftCode("");
    setGiftTyped("");
    setForfeitOk(false);
  };

  // The basket moved under an agreed forfeit: adding a dish changes what
  // is lost, so the tick has to be earned again.
  useEffect(() => {
    setForfeitOk(false);
  }, [giftCode, afterReward]);

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

  /**
   * The fulfilment window the venue is offering right now (P7-13).
   *
   * The server enumerates the slots; the app only ever steps along that
   * list, so it can never ask for a time the kitchen hasn't offered. A
   * republished menu can shorten the list under a guest who already
   * picked — in which case the pick is dropped back to ASAP rather than
   * sent and rejected.
   */
  const slots = menu.ordering.requestSlots ?? [];
  const slotIndex = slots.indexOf(requestedTime);
  useEffect(() => {
    if (requestedTime && !slots.includes(requestedTime)) setRequestedTime("");
  }, [requestedTime, slots]);
  const scheduled = requestedTime !== "" && slotIndex >= 0;
  const stepSlot = (delta: number): void => {
    const next = slots[slotIndex + delta];
    if (next) setRequestedTime(next);
  };

  /**
   * Is the kitchen taking orders for RIGHT NOW?
   *
   * The server's `ordering.acceptsAsapNow` is the seed; between payloads
   * the app re-derives it from the venue's own opening hours and
   * timezone on a 30 s tick (src/hours.ts), because a basket that sat
   * open across closing time used to keep offering "Now" until the next
   * fetch. Never the DEVICE's timezone — the venue's, or no client
   * verdict at all — and the SERVER still enforces it either way:
   * `/api/orders` answers `409 venue_closed` to a late ASAP or dine-in
   * order, and still takes a PRE-ORDER into a later slot today, which is
   * why the time picker survives and only "Now" goes away.
   */
  const openNow = useVenueOpenNow(
    menu.venue.hours,
    venueTimezone(menu.venue.timezone),
    menu.ordering.acceptsAsapNow !== false,
  );
  const asapOk = openNow !== false;
  // Closed, and nothing else to choose: "Now" is gone, so put the guest
  // on the first slot rather than leaving them on a dead option.
  useEffect(() => {
    if (!asapOk && orderType !== "dine_in" && !scheduled && slots[0]) {
      setRequestedTime(slots[0]);
    }
  }, [asapOk, orderType, scheduled, slots]);
  /** Nothing this basket can be turned into while the venue is shut:
   *  a table order, or a pickup/delivery with no later slot to take. */
  const closedBlocked = !asapOk && (orderType === "dine_in" || !scheduled);

  /**
   * Is there a delivery address to SHOW rather than ask for?
   *
   * The test is the SIGNED-IN PROFILE's saved address, never "the fields
   * happen to be full": a first-time guest typing their own address must
   * not watch the form fold into a card the instant they finish the
   * postcode. So the card appears only for an address this screen filled
   * in from `customer.lastDeliveryAddress` that the guest hasn't touched
   * — and a saved postcode the venue no longer serves is not one (the
   * prefill effect below refuses to seed it, so there would be nothing
   * to summarise).
   */
  const savedAddress = customer?.lastDeliveryAddress ?? null;
  const addressFromProfile =
    !addressTouched &&
    Boolean(savedAddress?.street?.trim()) &&
    Boolean(savedAddress?.zip?.trim()) &&
    (areas.length === 0 || areas.some((a) => a.zip === savedAddress?.zip));
  const addressFieldsOpen = editingAddress || !addressFromProfile;

  /** The one line under the title that says what is being waited on. The
   *  dev test panel says nothing here — its button is the whole message. */
  const placingLine =
    placing == null || placing.step === "placing" || placing.fake
      ? null
      : placing.step === "confirming"
        ? t.placingConfirm
        : placing.wallet
          ? t.placingWallet
          : placing.method === "paypal"
            ? t.placingPaypal
            : t.placingCard;
  /** Once the server has answered, ITS total is the one to show. */
  const placedTotal = placing?.order ? placing.order.chargedCents : chargedTotal;

  const needsContact = orderType !== "dine_in";
  const missing =
    cart.lines.length === 0 ||
    closedBlocked ||
    // No tick, no order: see the forfeit rule above.
    (forfeitNeeded && !forfeitOk) ||
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

  /**
   * Place the order, then pay it.
   *
   * `wallet` is the ONLY thing the Apple Pay / Google Pay button changes:
   * it forces the card route (a wallet is a card) and swaps the payment
   * sheet for the wallet sheet. Every other step — placement, the voucher
   * branch, the fake provider, the hosted-page fallback, the cancelled
   * and failed exits — is the same code as the ordinary Pay button.
   */
  async function submit({ wallet = false }: { wallet?: boolean } = {}): Promise<void> {
    if (busy) return; // double-tap guard: one in-flight order at a time
    const method: PayMethod = wallet ? "card" : payMethod;
    setBusy(true);
    setError(null);
    // The form gives way to the placing panel right now — the basket itself
    // is untouched, so whatever is drawn behind a payment sheet still shows
    // the guest what they ordered.
    setPlacing({ order: null, step: "placing", method, wallet });
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
        intendedPayment: method,
        // The app's language, so the order e-mail arrives in it.
        locale: lang,
        // Only ever true when the account really holds an armed voucher —
        // the server checks again and owns the outcome.
        redeemVoucher: rewardCents > 0 ? true : undefined,
        // Sent as typed; the server normalises it, re-checks that the
        // card is live and owns the amount that actually comes off.
        giftCardCode: giftCode || undefined,
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
        venue_closed: t.orderVenueClosed,
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
    // The same test for the card, and for the same reasons — it may have
    // been redeemed at the counter, expired, or simply never existed
    // (a mistyped code someone read out over the phone). The ORDER
    // stands; the guest is told once on the tracking screen.
    const giftCardFailed = giftCode !== "" && order.giftCardDiscountCents === 0 ? true : undefined;
    await rememberOrder({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      receiptToken: order.receiptToken,
      // What the guest actually pays — the number the history should show.
      totalCents: order.chargedCents,
      currency: menu.venue.currency,
      orderType,
      placedAt: new Date().toISOString(),
      payment: method,
    });
    // NOT cleared here. The cart is emptied only where this flow hands over
    // to the tracking screen, below.
    setPlacing({ order, step: "placing", method, wallet, rewardFailed, giftCardFailed });

    // The reward or the gift card covered the whole bill: the order is
    // already settled, so every payment branch below would be asking for
    // €0.00. The two flags are the same fact from two sources, and the
    // app must treat them identically.
    if (order.paidByVoucher || order.paidByGiftCard) {
      setBusy(false);
      setPlacing(null);
      cart.clear();
      clearGiftCard();
      onPlaced(order, { payment: method, paid: true, rewardFailed, giftCardFailed });
      return;
    }

    if (method === "cash") {
      setBusy(false);
      setPlacing(null);
      cart.clear();
      clearGiftCard();
      onPlaced(order, { payment: "cash", rewardFailed, giftCardFailed });
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
      clearGiftCard();
      onPlaced(order, { payment: method, note, paid, rewardFailed, giftCardFailed });
    };

    if (method === "paypal") {
      // Straight into PayPal: the server starts the payment and the
      // in-app browser opens on the approve page, then closes itself the
      // moment the return leg bounces back to the deep link.
      setPlacing({ order, step: "opening", method, rewardFailed, giftCardFailed });
      await payWithPaypal(order.orderId, order.receiptToken, lang);
      done();
      return;
    }

    setPlacing({ order, step: "paying", method, wallet, rewardFailed, giftCardFailed });
    const pay = wallet ? payWithPlatformPay : payWithCard;
    const outcome = await pay(order.orderId, order.receiptToken, {
      merchantDisplayName: menu.venue.name,
      wallets,
    });
    if (typeof outcome === "object") {
      // Fake provider (dev/CI): no sheet exists — and no wallet either,
      // because a wallet is only ever opened against a real Stripe
      // intent. Hand over to the test button rather than pretending the
      // payment went through.
      setPaying(false);
      setBusy(false);
      setPlacing({
        order,
        step: "paying",
        method,
        wallet,
        fake: { ref: outcome.fake.ref },
        rewardFailed,
        giftCardFailed,
      });
      return;
    }
    if (outcome === "unavailable") {
      // Expo Go, web, or a venue without a publishable key — the hosted
      // checkout page can still take the money.
      setPlacing({ order, step: "opening", method, rewardFailed, giftCardFailed });
      const hosted = await startHostedPayment(order.orderId, order.receiptToken);
      const url = hosted.ok
        ? hosted.url
        : payPageUrl(order.orderId, order.receiptToken, deepLink, lang);
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
      setPlacing({ order, step: "confirming", method, wallet, rewardFailed, giftCardFailed });
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
    const giftCardFailed = placing?.giftCardFailed;
    setPlacing({ order, step: "confirming", method: "card", rewardFailed, giftCardFailed });
    await confirmFakePayment(order.orderId, order.receiptToken, ref);
    setBusy(false);
    setPlacing(null);
    cart.clear();
    clearGiftCard();
    onPlaced(order, { payment: "card", paid: true, rewardFailed, giftCardFailed });
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
                {placing.order && placing.order.giftCardDiscountCents > 0 ? (
                  /* The SERVER's number once it has answered — the
                     preview above is only ever a courtesy. */
                  <Row
                    label={fill(t.cartGiftCardLine, {
                      last4: placing.order.giftCardLast4 ?? giftCardLast4(giftCode),
                    })}
                    value={`−${money(placing.order.giftCardDiscountCents, menu.venue.currency)}`}
                  />
                ) : giftCents > 0 ? (
                  <Row
                    label={fill(t.cartGiftCardLine, { last4: giftCardLast4(giftCode) })}
                    value={`−${money(giftCents, menu.venue.currency)}`}
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

              {/* Closed: say so once, in the words that fit the choice
                  the guest has just made — a table order cannot happen
                  at all, a pickup or delivery becomes a pre-order. */}
              {!asapOk ? (
                <Text style={styles.closedNote}>
                  {orderType === "dine_in"
                    ? t.orderClosedDineIn
                    : slots.length > 0
                      ? t.orderClosedNow
                      : t.orderClosedNoSlots}
                </Text>
              ) : null}

              {/* Dine-in asks for nothing mandatory (the table number is
                  optional), so the legend appears only with the form
                  that actually has required fields. */}
              {needsContact ? <RequiredLegend /> : null}

              {orderType === "dine_in" ? (
                <Field
                  label={t.tableOptional}
                  value={tableNumber}
                  onChange={setTableNumber}
                  placeholder={t.tablePlaceholder}
                />
              ) : (
                <>
                  {/* When to fulfil it: two radios, and a ± stepper over
                      the server's own slot list once "Scheduled" is
                      chosen. No free typing and no wrapping — the ends of
                      the list are the ends of the service window. */}
                  {slots.length > 0 ? (
                    <View style={{ gap: 8 }}>
                      <Text style={styles.fieldLabel}>
                        {orderType === "delivery" ? t.timeDelivery : t.timePickup}
                      </Text>
                      <View style={styles.radioRow}>
                        {/* "Now" is not offered while the venue is shut —
                            the server would refuse it with a 409, and an
                            option that cannot be taken is worse than no
                            option at all. */}
                        {asapOk ? (
                          <RadioChip
                            label={t.timeNow}
                            selected={!scheduled}
                            onPress={() => setRequestedTime("")}
                          />
                        ) : null}
                        <RadioChip
                          label={t.timeScheduled}
                          selected={scheduled}
                          onPress={() => {
                            if (!scheduled) setRequestedTime(slots[0] ?? "");
                          }}
                        />
                      </View>
                      {scheduled ? (
                        <View style={styles.stepper}>
                          <StepButton
                            icon="remove"
                            label={t.timeEarlier}
                            disabled={slotIndex <= 0}
                            onPress={() => stepSlot(-1)}
                          />
                          <Text style={styles.stepperValue}>{requestedTime}</Text>
                          <StepButton
                            icon="add"
                            label={t.timeLater}
                            disabled={slotIndex >= slots.length - 1}
                            onPress={() => stepSlot(1)}
                          />
                        </View>
                      ) : (
                        <Text style={styles.stepperHint}>{t.asap}</Text>
                      )}
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
                    required
                  />
                  <Field
                    label={t.phone}
                    value={phone}
                    onChange={setPhone}
                    placeholder="+49 …"
                    keyboardType="phone-pad"
                    required
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
              {orderType === "delivery" && !addressFieldsOpen ? (
                /* The address the app already knows, as a card. One tap on
                   "Change" turns it back into the fields — a returning
                   guest should not have to read past four inputs they
                   filled in weeks ago. */
                <View style={styles.addressCard}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.addressLabel}>{t.addressTitle}</Text>
                    <Text style={styles.addressLine}>{street.trim()}</Text>
                    <Text style={styles.addressLine}>
                      {[zip.trim(), area?.locality].filter(Boolean).join(" ")}
                    </Text>
                    {note.trim() ? (
                      <Text style={styles.addressNote} numberOfLines={2}>
                        {note.trim()}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => setEditingAddress(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.addressChange} — ${t.addressTitle}`}
                  >
                    <Text style={styles.addressChange}>{t.addressChange}</Text>
                  </Pressable>
                </View>
              ) : null}
              {orderType === "delivery" && addressFieldsOpen ? (
                <>
                  <Field
                    label={t.street}
                    value={street}
                    onChange={(v) => {
                      setAddressTouched(true);
                      setStreet(v);
                    }}
                    placeholder="Bahnhofstraße 15"
                    required
                  />
                  {areas.length > 0 ? (
                    /* Fixed delivery-area list: the guest PICKS a saved ZIP
                       from a dropdown — free typing would only earn an
                       outside_delivery_area rejection from the server. The
                       locality field beside it fills itself from the pick. */
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ gap: 4, width: 132 }}>
                        <FieldLabel label={t.zipLabel} required style={styles.fieldLabel} />
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
                                      setAddressTouched(true);
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
                      onChange={(v) => {
                        setAddressTouched(true);
                        setZip(v);
                      }}
                      placeholder="56068"
                      keyboardType="number-pad"
                      required
                    />
                  )}
                  <Field
                    label={t.noteOptional}
                    value={note}
                    onChange={(v) => {
                      setAddressTouched(true);
                      setNote(v);
                    }}
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
                {/* The gift card, UNDER the reward and styled to match:
                    the server spends the reward first and the card
                    covers what is left, so this is the order the
                    subtractions actually happen in. The value is shown
                    only when the app knows it — a forwarded code is
                    priced by the server, not guessed at here. */}
                {giftCode !== "" ? (
                  <View style={styles.rewardRow}>
                    <View style={styles.rewardLabelWrap}>
                      <Text style={styles.giftLabel}>
                        {fill(t.cartGiftCardLine, { last4: giftCardLast4(giftCode) })}
                      </Text>
                      <Pressable
                        onPress={clearGiftCard}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t.cartGiftCardRemove}
                      >
                        <Text style={styles.rewardNotNow}>{t.cartGiftCardRemove}</Text>
                      </Pressable>
                    </View>
                    {giftCents > 0 ? (
                      <Text style={styles.giftValue}>−{money(giftCents, menu.venue.currency)}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Row label={t.total} value={money(chargedTotal, menu.venue.currency)} bold />
              </View>

              {/* THE FORFEIT CONFIRM. Single use, full value: whatever
                  the card is worth beyond this bill is destroyed. The
                  order cannot be placed until this is ticked — see the
                  rule at the top of this screen. */}
              {forfeitNeeded ? (
                <View style={styles.forfeitBox}>
                  {giftValueKnown && appliedCard ? (
                    <Text style={styles.forfeitText}>
                      {fill(t.cartGiftCardForfeit, {
                        value: money(appliedCard.valueCents, menu.venue.currency),
                        total: money(afterReward, menu.venue.currency),
                        rest: money(forfeitCents, menu.venue.currency),
                      })}
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={() => setForfeitOk((on) => !on)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: forfeitOk }}
                    accessibilityLabel={t.cartGiftCardForfeitAgree}
                    style={({ pressed }) => [styles.forfeitAgree, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons
                      name={forfeitOk ? "checkbox" : "square-outline"}
                      size={22}
                      color={forfeitOk ? colors.red : colors.inkSoft}
                    />
                    <Text style={styles.forfeitAgreeText}>{t.cartGiftCardForfeitAgree}</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* "Use a gift card" — offered only to a signed-in guest
                  who actually holds one. The picker and the code field
                  sit together because they are the same decision: a card
                  is a bearer instrument, so someone else's code is every
                  bit as valid as one from this account's own list. */}
              {auth.token && myCards.length > 0 && giftCode === "" ? (
                <View style={{ gap: 8 }}>
                  <Pressable
                    onPress={() => setGiftOpen((open) => !open)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: giftOpen }}
                    accessibilityLabel={t.cartUseGiftCard}
                    style={({ pressed }) => [styles.giftOpenRow, pressed && { opacity: 0.75 }]}
                  >
                    <Ionicons name="card-outline" size={20} color={colors.red} />
                    <Text style={styles.giftOpenText}>{t.cartUseGiftCard}</Text>
                    <Ionicons
                      name={giftOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={colors.inkSoft}
                    />
                  </Pressable>

                  {giftOpen ? (
                    <View style={styles.giftPanel}>
                      <Text style={styles.giftPanelLabel}>{t.cartGiftCardPick}</Text>
                      {myCards.map((card) => (
                        <Pressable
                          key={card.id}
                          onPress={() => {
                            setGiftCode(card.code);
                            setGiftOpen(false);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`${money(card.valueCents, card.currency)} · ${card.codeFormatted.split("-").join(" ")}`}
                          style={({ pressed }) => [styles.giftCardRow, pressed && { opacity: 0.7 }]}
                        >
                          <Text style={styles.giftCardValue}>
                            {money(card.valueCents, card.currency)}
                          </Text>
                          <Text style={styles.giftCardCode} numberOfLines={1}>
                            {card.codeFormatted}
                          </Text>
                        </Pressable>
                      ))}

                      <Text style={styles.giftPanelLabel}>{t.cartGiftCardEnter}</Text>
                      <View style={styles.giftEnterRow}>
                        <TextInput
                          value={giftTyped}
                          onChangeText={setGiftTyped}
                          placeholder={t.redeemGiftCardPlaceholder}
                          placeholderTextColor={colors.inkSoft}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          maxLength={200}
                          accessibilityLabel={t.cartGiftCardEnter}
                          style={styles.giftInput}
                        />
                        <Pressable
                          onPress={() => {
                            const typed = giftTyped.trim();
                            if (!typed) return;
                            setGiftCode(normalizeGiftCardCode(typed));
                            setGiftOpen(false);
                          }}
                          disabled={giftTyped.trim().length < 4}
                          accessibilityRole="button"
                          accessibilityLabel={t.cartGiftCardApply}
                          style={({ pressed }) => [
                            styles.giftApply,
                            giftTyped.trim().length < 4 && { opacity: 0.5 },
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          <Text style={styles.giftApplyText}>{t.cartGiftCardApply}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* What this basket is worth in points, said where the
                  guest is already reading the money. Signed out it
                  doubles as the reason to sign in — the Google button
                  itself is already offered above, so this stays one
                  quiet line rather than a second call to action. */}
              {earnsPoints && loyalty ? (
                <Text style={styles.earnLine}>
                  {fill(auth.token ? t.cartEarnPoints : t.cartEarnSignIn, {
                    points: earnedPoints,
                  })}
                </Text>
              ) : null}

              {/* Apple Pay / Google Pay, above the list and above the
                  ordinary button: one tap places and pays. Rendered ONLY
                  when the device, the build and the venue all support it
                  — otherwise nothing at all is drawn here (P7-13). */}
              {PlatformPay && !fullyCovered ? (
                <View style={{ gap: 6, marginTop: 8 }}>
                  <PlatformPay
                    onPress={() => {
                      setPayMethod("card");
                      void submit({ wallet: true });
                    }}
                    disabled={missing || busy}
                    borderRadius={radius.md}
                    style={styles.walletButton}
                  />
                  {/* Only when there IS another way below to choose. */}
                  {payOptions.length > 1 ? (
                    <Text style={styles.walletDivider}>{t.payOrChoose}</Text>
                  ) : null}
                </View>
              ) : null}

              {/* One option = no choice to make; the hint below still says
                  what will happen. A fully covered order has nothing to
                  charge, so there is no method to pick either. */}
              {payOptions.length > 1 && !fullyCovered ? (
                <View style={{ gap: 8, marginTop: 4 }}>
                  <Text style={styles.fieldLabel}>{t.paymentMethod}</Text>
                  <View style={{ gap: 8 }}>
                    {payOptions.map((option) => {
                      const selected = payMethod === option.key;
                      return (
                        <Pressable
                          key={option.key}
                          onPress={() => setPayMethod(option.key)}
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
                          <Text
                            style={[styles.payRowText, selected && { color: colors.red }]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                          {/* Decorative: the row already says what it is,
                              so the marks are not a second thing to read. */}
                          <View
                            style={styles.payMarks}
                            importantForAccessibility="no-hide-descendants"
                            accessibilityElementsHidden
                          >
                            {option.key === "card" ? (
                              <>
                                <VisaMark />
                                <MastercardMark />
                              </>
                            ) : option.key === "paypal" ? (
                              <PaypalMark />
                            ) : (
                              <CashMark />
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PrimaryButton
                label={
                  coveredByReward
                    ? fill(t.cartPlaceWithReward, {
                        total: money(0, menu.venue.currency),
                      })
                    : // The card settles the whole bill: the server marks
                      // the order paid on placement, so this button
                      // PLACES rather than pays and no sheet follows.
                      coveredByGiftCard
                      ? t.cartPlaceWithGiftCard
                      : payMethod === "cash"
                        ? `${t.placeOrder} · ${money(chargedTotal, menu.venue.currency)}`
                        : giftCode !== ""
                          ? fill(t.cartPayRemaining, {
                              total: money(chargedTotal, menu.venue.currency),
                            })
                          : `${t.payNow} ${money(chargedTotal, menu.venue.currency)}`
                }
                busyLabel={paying ? t.openingPayment : undefined}
                tone="red"
                onPress={() => void submit()}
                disabled={missing}
                busy={busy}
              />
              {/* Name the instrument that actually covered the bill. A
                  gift card is money the guest PAID for, and saying
                  "your reward covers this" at the moment they are being
                  asked to accept losing the remainder names the wrong
                  thing entirely — so when both a reward and a card
                  applied, the card is the one that gets the credit. */}
              <Text style={styles.payNote}>
                {coveredByGiftCard
                  ? t.payNothingDueGiftCard
                  : fullyCovered
                    ? t.payNothingDue
                    : payHint}
              </Text>
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
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "phone-pad" | "number-pad" | "email-address";
  hint?: string;
  /** Marked with an asterisk — and it is set ONLY where `missing` above
   *  actually blocks the order on this field. */
  required?: boolean;
}): React.ReactElement {
  const isEmail = keyboardType === "email-address";
  return (
    <View style={{ gap: 4 }}>
      <FieldLabel label={label} required={required} style={styles.fieldLabel} />
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

/** "Now" / "Scheduled" — a radio drawn as a chip, so the two choices are
 *  one tap apart and neither is hidden inside a menu (P7-13). */
function RadioChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[styles.radioChip, selected && styles.radioChipActive]}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={18}
        color={selected ? colors.red : colors.inkSoft}
      />
      <Text style={[styles.radioChipText, selected && { color: colors.red }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One end of the time stepper. Disabled at the ends of the server's slot
 *  list — the list never wraps, because 21:45 is not "earlier" than 11:00. */
function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "add" | "remove";
  label: string;
  disabled: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.stepBtn, disabled && styles.stepBtnOff]}
    >
      <Ionicons name={icon} size={20} color={disabled ? colors.inkSoft : colors.red} />
    </Pressable>
  );
}

/* ── Payment brand marks ─────────────────────────────────────────────────
 *
 * Drawn here as inline SVG rather than shipped as images: four small
 * vectors cost nothing in the bundle, stay sharp at any density, and
 * never 404. They are simplified, generic representations — enough for a
 * guest to recognise the row at a glance, not facsimiles of the
 * trademarks. They are decorative: every row carries its own text label,
 * and the marks are hidden from the accessibility tree.
 */

const MARK_W = 34;
const MARK_H = 22;

function VisaMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#1a1f71" />
      <SvgText
        x={17}
        y={15}
        fill="#ffffff"
        fontSize={9}
        fontWeight="bold"
        letterSpacing={0.5}
        textAnchor="middle"
      >
        VISA
      </SvgText>
    </Svg>
  );
}

function MastercardMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#ffffff" stroke={colors.line} />
      <Circle cx={14} cy={11} r={6.5} fill="#eb001b" />
      <Circle cx={20} cy={11} r={6.5} fill="#f79e1b" opacity={0.85} />
    </Svg>
  );
}

function PaypalMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#ffffff" stroke={colors.line} />
      <Path d="M15 4 h6 a4 4 0 1 1 0 8 h-3 l-1 6 h-3 z" fill="#009cde" />
      <Path d="M10 4 h6 a4 4 0 1 1 0 8 h-3 l-1 6 h-3 z" fill="#003087" />
    </Svg>
  );
}

function CashMark(): React.ReactElement {
  return (
    <Svg width={MARK_W} height={MARK_H} viewBox="0 0 34 22">
      <Rect x={0.5} y={0.5} width={33} height={21} rx={3} fill="#ffffff" stroke={colors.line} />
      <Rect x={4} y={5} width={26} height={12} rx={2} fill="#e9f3e4" stroke="#3f7030" />
      <Circle cx={17} cy={11} r={3.2} fill="none" stroke="#3f7030" strokeWidth={1.2} />
    </Svg>
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
  // Payment choice: full-width rows, one per method, each with its brand
  // mark on the trailing edge. A row (not a chip) because the guest is
  // choosing how money moves — it should be the easiest thing to hit on
  // the screen, and the marks need somewhere to sit (P7-13).
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 52,
    backgroundColor: colors.creamCard,
  },
  payRowActive: { borderColor: colors.red, backgroundColor: "#fdeee6" },
  payRowText: { flex: 1, color: colors.ink, fontSize: 14, ...fonts.bodyBold },
  payMarks: { flexDirection: "row", alignItems: "center", gap: 5 },
  // Stripe draws the wallet button itself; we only own the box it fills.
  walletButton: { height: 48, width: "100%" },
  walletDivider: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
  // "Now" / "Scheduled", then the ± stepper over the server's slots.
  radioRow: { flexDirection: "row", gap: 8 },
  radioChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 8,
    minHeight: 46,
    backgroundColor: colors.creamCard,
  },
  radioChipActive: { borderColor: colors.red, backgroundColor: "#fdeee6" },
  radioChipText: { color: colors.inkSoft, fontSize: 13, ...fonts.bodyBold, flexShrink: 1 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 6,
  },
  stepBtn: {
    width: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.red,
    borderRadius: radius.sm,
    backgroundColor: colors.cream,
  },
  stepBtnOff: { borderColor: colors.line, opacity: 0.55 },
  stepperValue: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 20 },
  stepperHint: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5 },
  // The saved delivery address, shown rather than asked for.
  addressCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
  },
  addressLabel: {
    color: colors.inkSoft,
    ...fonts.bodySemi,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  addressLine: { color: colors.ink, ...fonts.bodySemi, fontSize: 14.5 },
  addressNote: { color: colors.inkSoft, ...fonts.body, fontSize: 12.5, marginTop: 2 },
  addressChange: {
    color: colors.red,
    ...fonts.bodyBold,
    fontSize: 13,
    textDecorationLine: "underline",
  },
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
  // The gift-card line: the same row as the reward above it, in the
  // brand red rather than the gold, so the two subtractions read as
  // siblings without pretending to be the same thing.
  giftLabel: { color: colors.red, ...fonts.bodyBold, fontSize: 14, flexShrink: 1 },
  giftValue: { color: colors.red, ...fonts.bodyHeavy, fontSize: 14 },
  giftOpenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
  giftOpenText: { flex: 1, color: colors.ink, ...fonts.bodyBold, fontSize: 14 },
  giftPanel: {
    gap: 8,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 12,
  },
  giftPanelLabel: { color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12 },
  giftCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.cream,
  },
  giftCardValue: { color: colors.ink, ...fonts.bodyHeavy, fontSize: 14 },
  giftCardCode: { flex: 1, color: colors.inkSoft, ...fonts.bodySemi, fontSize: 12.5 },
  giftEnterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  giftInput: {
    flex: 1,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    minHeight: 44,
    color: colors.ink,
    ...fonts.bodySemi,
    fontSize: 14,
    letterSpacing: 1,
  },
  giftApply: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.red,
  },
  giftApplyText: { color: colors.onRed, ...fonts.bodyBold, fontSize: 13.5 },
  // The one warning on this screen a guest can lose money by ignoring,
  // so it gets the danger tint rather than the quiet gold of a hint.
  forfeitBox: {
    gap: 8,
    backgroundColor: "#fdeae8",
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: 12,
  },
  forfeitText: { color: "#8a1c15", ...fonts.bodySemi, fontSize: 13, lineHeight: 18 },
  forfeitAgree: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  forfeitAgreeText: { flex: 1, color: colors.ink, ...fonts.bodyBold, fontSize: 13.5 },
  rowLabel: { color: colors.inkSoft, ...fonts.body, fontSize: 14 },
  rowValue: { color: colors.ink, fontSize: 14, ...fonts.bodySemi },
  rowBold: { ...fonts.bodyHeavy, fontSize: 16, color: colors.ink },
  zipInfo: { color: colors.inkSoft, ...fonts.body, fontSize: 12, marginTop: 2 },
  minWarn: { color: colors.danger, fontSize: 12, ...fonts.bodySemi },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, textAlign: "center" },
  /** "We're closed right now" — a statement of fact about the kitchen,
   *  not a failure the guest caused, so it reads in the brand red rather
   *  than the danger red the order errors use. */
  closedNote: {
    color: colors.red,
    ...fonts.bodySemi,
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  payNote: {
    color: colors.inkSoft,
    ...fonts.body,
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
  },
});
