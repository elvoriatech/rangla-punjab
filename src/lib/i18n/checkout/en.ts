/**
 * Guest checkout copy — ENGLISH. This file is also the SHAPE: every
 * other locale is typed `CheckoutCopy = typeof en`, so TypeScript fails
 * the build the moment one of them misses a key.
 *
 * Covers everything from "open the cart" to "order placed": the cart
 * drawer and the Add button on every dish card.
 *
 * No i18n runtime (CLAUDE.md): one plain object per locale. Parameterised
 * strings are functions rather than templates with positional markers —
 * the translator moves the value where the sentence needs it, which is
 * the whole point in `ar`.
 *
 * Money is always pre-formatted by the caller (`formatCents`), so these
 * strings never see cents or a currency code.
 *
 * P7-16: one file PER LOCALE so `./load.ts` emits one chunk per language
 * and a guest downloads only the words they can read. Nothing in this
 * folder may import a sibling locale at runtime.
 */

const en = {
  /* Floating bar + sheet chrome */
  yourOrder: "Your order",
  placedBadge: (n: string) => `Order #${n} ✓`,
  headingPlaced: (n: string) => `Order #${n}`,
  close: "Close order panel",

  /* Line items */
  each: (price: string) => `${price} each`,
  oneLess: (name: string) => `One less ${name}`,
  oneMore: (name: string) => `One more ${name}`,
  removeLine: (name: string) => `Remove ${name} from the order`,
  remove: "Remove",
  total: "Total",
  vatIncluded: (rate: string, amount: string) => `incl. ${rate}% VAT ${amount}`,
  /* Loyalty — one line under the total; shown only when the restaurant
     collects points and this basket already qualifies. */
  loyaltyEarn: (points: string) => `You'll earn ${points} points with this order`,
  loyaltySignIn: (points: string) => `Sign in to earn ${points} points on this order`,
  clearCart: "Clear cart",
  addItems: "Add items",

  /* Order type */
  orderTypeGroup: "Order type",
  dineIn: "Dine-in",
  takeaway: "Pickup",
  delivery: "Delivery",

  /* Fields */
  tableNumber: "Table number (optional)",
  tableNumberPlaceholder: "e.g. 12",
  yourName: "Your name",
  phone: "Phone number",
  phonePlaceholder: "+49 …",
  deliveryTime: "Delivery time",
  pickupTime: "Pickup time",
  asap: "As soon as possible",
  email: "Email (optional) — we'll send your receipt",
  emailPlaceholder: "you@example.com",
  street: "Street and house number",
  zip: "ZIP",
  selectPlaceholder: "Select…",
  city: "City / Community / Village",
  cityPlaceholder: "— select your ZIP —",
  deliveryNote: "Delivery note (optional)",
  deliveryNotePlaceholder: "e.g. ring twice, 3rd floor",

  /* Saved delivery address, shown as a card instead of four open fields
     (P7-13). "Change" turns it back into the fields. */
  addressTitle: "Delivery address",
  addressChange: "Change",

  /* When to fulfil it: two radios, then a ± stepper over the server's
     own slot list (P7-13). */
  timeNow: "Now",
  timeScheduled: "Scheduled",
  /* Closed right now: ASAP is off, and the only order a guest can still
     place is one scheduled into a later open slot today. */
  closedPreorderNote: "We're closed right now — you can pre-order for later today.",
  closedDineIn: "Ordering at the table is only possible during opening hours.",
  timeEarlier: "Earlier",
  timeLater: "Later",

  /* Delivery economics */
  freeDeliveryHere: "Free delivery to this area 🎉",
  freeDeliveryFrom: (amount: string) => `Free delivery from ${amount}`,
  deliveryFee: (fee: string) => `Delivery fee ${fee}`,
  minimumOrderSuffix: (min: string) => ` · minimum order ${min}`,
  minimumOrder: (min: string) => `Minimum order ${min}`,
  belowMinimum: (min: string, missing: string) =>
    `Delivery starts at ${min} — add ${missing} more.`,

  /* Pay row */
  payGroup: "Place order and pay",
  /* One row per method, radio-style, with the brand marks beside it
     (P7-13). The wallet button sits above the list when the browser has
     one to offer. */
  paymentMethod: "Payment",
  payOrChoose: "or choose another way to pay",
  pay: "Pay",
  placeOrder: "Place order",
  card: "Card",
  paypal: "PayPal",
  payAtTable: "Pay at table",
  payAtPickup: "Pay at pickup",
  cashToDriver: "Cash to driver",
  placing: "Placing…",
  opening: "Opening…",
  explainerOnline: "Pay securely",
  explainerDelivery: "No payment online — you pay the driver.",
  explainerPickup: "No payment online — you pay at pickup.",
  explainerDineIn: "No payment now — you pay at the restaurant.",
  securedBy: (providers: string) => `Secure payment processing with ${providers}`,

  /* Confirmation */
  placedIntro: "Your order is in — the staff sees it as",
  placedRef: (n: string) => `order #${n}`,
  placedForTable: (table: string) => ` for table ${table}`,
  placedCashTail: ", payable at the restaurant. Your receipt is downloading.",
  placedEmailTail: (email: string, pending: boolean) =>
    ` We'll email your receipt to ${email}${pending ? " once the payment is confirmed" : ""}.`,
  payOnline: (amount: string) => `Pay online · ${amount}`,
  openingPayment: "Opening payment…",
  openingPaypal: "Opening PayPal…",
  payWithPaypal: "Pay with PayPal",
  trackOrder: "Track your order",
  downloadReceipt: "Download receipt (PDF)",
  startNewOrder: "Start a new order",

  /* Errors — one per failure the server can report, plus the two network ones */
  errPaypalOpen:
    "PayPal couldn't be opened — your order is saved; try the PayPal button below or pay at the restaurant.",
  errCardOpen:
    "Card payment couldn't be opened — your order is saved; try the button below or pay at the restaurant.",
  errPayRetry: "No connection — your order is saved; try paying again below.",
  errWalletPay:
    "The wallet payment didn't go through — your order is saved; try another way to pay below.",
  errUnknownItems:
    "The menu changed while you were ordering. Please review your items and try again.",
  errRateLimited: "Too many orders from this connection — please wait a minute.",
  errTypeNotAvailable: "This order type just went offline — pick another option.",
  errOutsideArea: "Sorry, that address is outside the delivery area.",
  errBelowMinimum: (min: string) => `Delivery starts at ${min} — add a little more.`,
  errInvalidTime: "That time just passed or is outside opening hours — pick another.",
  errVenueClosed: "We've just closed — pick a later time today, or try again tomorrow.",
  errGeneric: "The order didn't go through. Please try again.",
  errNoConnection: "No connection — check your network and try again.",

  /* Add button on the dish card */
  add: "+ Add",
  added: "Added ✓",
  addAria: (name: string) => `Add ${name} to order`,

  /* Required-field convention (one mark, one legend per form). */
  requiredMark: "(required)",
  requiredLegend: "* required field",
};

export type CheckoutCopy = typeof en;

export default en;
