"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import { MessagePopup } from "@/components/message-popup";
import { acceptedPaymentIds, PaymentMarks } from "../payment-marks";
import type { PaymentMethodId } from "@/lib/payment-methods";
import type { CheckoutCopy } from "@/lib/i18n/checkout/en";
import { loadCheckoutCopy } from "@/lib/i18n/checkout/load";
import { dirFor, uiLocale } from "@/lib/locales";
import { VAT_RATE_LABEL, vatFromGross } from "@/lib/vat";
import { pointsForFood } from "@/lib/loyalty-points";
import { RequiredLegend, RequiredMark } from "@/components/required-mark";
import {
  EMPTY_CART,
  cartCount,
  cartTotalCents,
  clearCart,
  formatCents,
  getCartSnapshot,
  newRequestId,
  setQuantity,
  subscribeToCart,
} from "./cart-store";
import { rememberOrder } from "./last-order-store";

interface PlacedOrder {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  currency: string;
  receiptToken: string;
}

/**
 * Apple Pay / Google Pay (P7-13). Split into its own chunk and pulled in
 * only after the server has confirmed there IS a Stripe publishable key
 * to build a payment request with — so `@stripe/stripe-js` (and the
 * js.stripe.com script it injects) never reaches a guest who could not
 * have used a wallet anyway.
 */
const WalletPayButton = dynamic(() => import("./wallet-button").then((m) => m.WalletPayButton), {
  ssr: false,
});

/** What `/api/v1/pay/wallet-config` answers. `publishableKey: null` — no
 *  Stripe account, a fake provider, or a fee model the intent endpoint
 *  refuses — means no wallet button is drawn at all. */
interface WalletConfig {
  publishableKey: string | null;
  applePay: boolean;
  country: string;
}

/**
 * Floating order bar + bottom-sheet drawer. Everything themes itself via
 * the menu CSS vars. Flow: build the order → place it (server recomputes
 * every price) → confirmation with order number + PDF receipt link.
 */
function CartIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.3h7.8a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

type OrderType = "dine_in" | "takeaway" | "delivery";

export interface DrawerDeliveryArea {
  zip: string;
  locality: string;
  feeCents: number;
  minCents: number;
  freeOverCents: number;
}

export interface DrawerModes {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  deliveryAreas: DrawerDeliveryArea[];
  deliveryFeeCents: number;
  deliveryMinCents: number;
}

/** What the drawer needs to talk about points. Mirrors the `loyalty`
 *  block of `/api/v1/menu`, minus the reward numbers the cart never
 *  mentions. */
export interface DrawerLoyalty {
  enabled: boolean;
  minOrderCents: number;
  pointsPerOrder: number;
}

/** The label is a catalogue KEY — the words come from `checkoutCopy`, so
 *  this table stays language-free. */
const TYPE_META: {
  type: OrderType;
  icon: string;
  label: "dineIn" | "takeaway" | "delivery";
  enabled: (m: DrawerModes) => boolean;
}[] = [
  { type: "dine_in", icon: "🍽", label: "dineIn", enabled: (m) => m.dineIn },
  { type: "takeaway", icon: "🥡", label: "takeaway", enabled: (m) => m.takeaway },
  { type: "delivery", icon: "🛵", label: "delivery", enabled: (m) => m.delivery },
];

/** The slice of `GET /api/v1/me` the drawer prefills from. Every field is
 *  optional on purpose: older deployments answer with `{email,name}` only,
 *  and the drawer must not care. */
interface CustomerProfile {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  lastDeliveryAddress?: {
    street?: string | null;
    zip?: string | null;
    city?: string | null;
    note?: string | null;
  } | null;
}

/* ------------------------------------------------------------------------- *
 * Control recipes — fill as the affordance, not a border.
 *
 * A border cannot be the affordance here: `--menu-line` against its own
 * `--menu-surface` is 1.03–1.63:1 on 17 of the 19 themes (an invisible
 * hairline) but 3.96:1 on rangla-royal and 18.13:1 on street-bold — so the
 * same class that vanishes on most themes paints hard rules on those two, and
 * this sheet used to carry ~21 of them. A low-alpha tint OF THE SURFACE INK is
 * self-scaling instead: the same relative step off the ground on every theme,
 * light or dark.
 *
 * Three rules the constants encode. Each one is a defect this replaced:
 *   1. Ink carries ALL small text; accent is a fill/graphic color only.
 *      accent-on-surface is guaranteed at 3:1, not 4.5:1 — the old selected
 *      chip put a 12px label in accent at 3.28:1 on fresh-bistro.
 *   2. Labels stay FULL ink at rest and on hover; the wash carries the
 *      de-emphasis. Soft ink on the 13% hover wash is ~3.96:1.
 *   3. Danger colors washes, glyphs and rails; ink carries the words. Danger
 *      on its own 12% wash is ~3.87:1 — fine for a glyph, short of AA for text.
 *
 * Every pair below is asserted for all 19 themes in
 * menu-themes-contrast.test.ts → "cart-drawer control recipes". Change an
 * alpha here, change it there. garden-gold is the binding worst case.
 *
 * NOTE: each var is spelled out literally. Tailwind scans source TEXT, so an
 * interpolated `bg-[${INK}]/7` compiles to nothing at all; composing whole
 * utilities with `+` is fine.
 * ------------------------------------------------------------------------- */

/** Removing the borders removed the inputs' only focus affordance
 *  (`outline-none focus:border-…`, itself a 2.4.7 defect since a 1px
 *  low-contrast border was the whole indicator) and the buttons never had one.
 *  Ink is the ring color because ink-vs-surface is the one pair guaranteed on
 *  every theme AND every backdrop pairing; `outline-offset-2` keeps the surface
 *  between ring and control so the ring's adjacent color is always the ground. */
/** Arabic is cursive: `uppercase` does nothing to it and `letter-spacing`
 *  pulls joined letters apart, so every small-caps label drops both when the
 *  page is RTL. Spelled out literally — Tailwind scans source text. */
const RTL_TYPE = " rtl:normal-case rtl:tracking-normal";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-text,var(--menu-text))]";

/** Round icon-only control. 1.4.11 is satisfied by the glyph (4.62:1 composited
 *  at worst), not by the wash, and 32px clears the 24px target floor of 2.5.8. */
const ICON_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 text-[var(--menu-surface-text,var(--menu-text))] transition hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 active:scale-90 " +
  FOCUS_RING;

/** Secondary pill. */
const QUIET_BTN =
  "flex items-center justify-center gap-2 rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--menu-surface-text,var(--menu-text))] transition hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 active:scale-[0.98]" +
  RTL_TYPE +
  " " +
  FOCUS_RING;

/** Destructive pill: neutral at rest, danger wash on hover, danger ICON only —
 *  the label stays ink. Declares its own `hover:bg-*` rather than composing
 *  onto QUIET_BTN because two competing `hover:bg-*` utilities resolve by
 *  Tailwind's sort order, not by their order in the string. */
const DANGER_BTN =
  "flex items-center justify-center gap-2 rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--menu-surface-text,var(--menu-text))] transition hover:bg-[var(--menu-danger)]/12 [&_svg]:transition-colors hover:[&_svg]:text-[var(--menu-danger)] active:scale-[0.98]" +
  RTL_TYPE +
  " " +
  FOCUS_RING;

/** Per-row remove: no fill at rest, because one of these sits in every row and
 *  they must not compete with the dish names. */
const ROW_DELETE_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--menu-surface-text-soft,var(--menu-text-soft))] transition hover:bg-[var(--menu-danger)]/12 hover:text-[var(--menu-danger)] focus-visible:text-[var(--menu-danger)] active:scale-90 " +
  FOCUS_RING;

/** Order-type chips. `relative`/`overflow-hidden` host the selected indicator
 *  bar and `pb-2.5` reserves its room, so selecting never shifts the label. */
type PayMethod = "cash" | "card" | "paypal";

const CHIP_BASE =
  "relative overflow-hidden rounded-lg px-2 pt-2 pb-2.5 text-center text-xs transition " +
  FOCUS_RING;
const CHIP_IDLE =
  CHIP_BASE +
  " bg-[var(--menu-surface-text,var(--menu-text))]/7 text-[var(--menu-surface-text,var(--menu-text))] hover:bg-[var(--menu-surface-text,var(--menu-text))]/13";
const CHIP_ON =
  CHIP_BASE +
  " bg-[var(--menu-surface-accent,var(--menu-accent))]/14 font-semibold text-[var(--menu-surface-text,var(--menu-text))]";

/** Text field: a 6% ink wash + ONE accent underline. 1.4.11 wants a 3:1
 *  boundary on a text input; accent gives ≥3.28:1 on every theme where the old
 *  `--menu-line` hairline gave 1.03–1.63:1 on 17 of 19 — so the bordered
 *  version was the one that failed. Three edges go, one deliberate line stays.
 *  The wash is ink-relative, not `--menu-bg`: bg == surface on foodota
 *  (#ffffff/#ffffff), where a `--menu-bg` field with no border is invisible. */
const FIELD =
  "mt-1 w-full rounded-t-md border-b border-[var(--menu-surface-accent,var(--menu-accent))] bg-[var(--menu-surface-text,var(--menu-text))]/6 px-3 py-2 text-[var(--menu-surface-text,var(--menu-text))] placeholder:text-[var(--menu-surface-text-soft,var(--menu-text-soft))] " +
  FOCUS_RING;

/** Native <select>: Chrome paints the option popup from the control's own
 *  background, and a translucent one composites to near-white there — which
 *  would strand light ink on a light popup. Safari uses the native menu and
 *  ignores these, which is also fine. */
const FIELD_SELECT =
  FIELD +
  " [&>option]:bg-[var(--menu-surface)] [&>option]:text-[var(--menu-surface-text,var(--menu-text))]";

/** Read-only mirror: no wash, no underline — it should read as text so nobody
 *  tries to type into it. */
const FIELD_READONLY =
  "mt-1 w-full px-3 py-2 text-[var(--menu-surface-text-soft,var(--menu-text-soft))]";

const FIELD_LABEL = "text-[var(--menu-surface-text-soft,var(--menu-text-soft))]";

const CTA_BASE =
  "block w-full rounded-full px-5 py-3 text-center text-sm uppercase tracking-[0.14em] transition" +
  RTL_TYPE +
  " ";

/** The one dominant fill on the screen. `--menu-on-surface-accent` rather than
 *  `--menu-bg`, which is ~3.5:1 on fresh-bistro's accent — an AA failure on the
 *  most important button in the product. */
const CTA_PRIMARY =
  CTA_BASE +
  "bg-[var(--menu-surface-accent,var(--menu-accent))] font-semibold text-[var(--menu-on-surface-accent,var(--menu-bg))] hover:opacity-90 active:scale-[0.985] disabled:opacity-50 " +
  FOCUS_RING;

const CTA_PAY =
  CTA_BASE +
  "bg-[var(--menu-positive)] font-semibold text-[var(--menu-on-positive,var(--menu-bg))] hover:opacity-90 active:scale-[0.985] disabled:opacity-60 " +
  FOCUS_RING;

/**
 * Payment ROWS (P7-13, owner's mockup): one full-width row per method,
 * radio-style, brand marks on the end edge. They only CHOOSE — a single
 * CTA underneath places the order — which is what lets Apple Pay / Google
 * Pay sit above them as a genuine one-tap alternative.
 *
 * The tiles this replaced each placed the order on tap, so "card" was a
 * commitment rather than a choice and there was nowhere to put a wallet
 * button that did not read as a fourth, differently-behaved tile.
 *
 * 52px min height clears the 44px target floor of 2.5.5 with room for the
 * 32px brand chips.
 */
const PAY_ROW_BASE =
  "relative flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm transition active:scale-[0.99] disabled:opacity-50 " +
  FOCUS_RING;
const PAY_ROW_IDLE =
  PAY_ROW_BASE +
  " bg-[var(--menu-surface-text,var(--menu-text))]/7 text-[var(--menu-surface-text,var(--menu-text))] hover:bg-[var(--menu-surface-text,var(--menu-text))]/13";
const PAY_ROW_ON =
  PAY_ROW_BASE +
  " bg-[var(--menu-surface-accent,var(--menu-accent))]/14 font-semibold text-[var(--menu-surface-text,var(--menu-text))]";

/** Now / Scheduled. Same recipe as the order-type chips, but with no icon
 *  row above the label they need an explicit height to clear 44px. */
const TIME_CHIP_IDLE = CHIP_IDLE + " min-h-[44px]";
const TIME_CHIP_ON = CHIP_ON + " min-h-[44px]";

/** ± over the server's slot list. 44px round targets, and `disabled` at
 *  the ends of the list rather than wrapping — the ends of the list are
 *  the ends of the service window. */
const STEP_BTN =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 text-lg leading-none text-[var(--menu-surface-text,var(--menu-text))] transition hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 active:scale-90 disabled:opacity-40 disabled:hover:bg-[var(--menu-surface-text,var(--menu-text))]/7 " +
  FOCUS_RING;

/** "Change" on the saved-address card: a text control, so the underline
 *  identifies it, padded to a 44px target. */
const CHANGE_BTN =
  "inline-flex min-h-[44px] shrink-0 items-center rounded-full px-3 text-xs font-medium text-[var(--menu-surface-text,var(--menu-text))] underline decoration-1 underline-offset-4 transition hover:bg-[var(--menu-surface-text,var(--menu-text))]/10 " +
  FOCUS_RING;

/** The selection carrier that is NOT colour: an empty ring becomes a
 *  filled disc. 1.4.1 wants a shape, not just a wash. */
function RadioDot({ on }: { on: boolean }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      {on ? <circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

function CashIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 12h.01M18 12h.01" strokeLinecap="round" />
    </svg>
  );
}

const CTA_SECONDARY =
  CTA_BASE +
  "bg-[var(--menu-surface-text,var(--menu-text))]/7 font-medium text-[var(--menu-surface-text,var(--menu-text))] hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 active:scale-[0.985] " +
  FOCUS_RING;

/** Tertiary: no fill, no border — the underline identifies it as a control. */
const CTA_LINK =
  "block w-full rounded-full px-5 py-2.5 text-center text-xs uppercase tracking-[0.14em] text-[var(--menu-surface-text-soft,var(--menu-text-soft))] underline decoration-1 underline-offset-4 transition hover:text-[var(--menu-surface-text,var(--menu-text))]" +
  RTL_TYPE +
  " " +
  FOCUS_RING;

export function CartDrawer({
  slug,
  currency,
  locale,
  modes,
  requestSlots = [],
  acceptsAsapNow = true,
  onlinePayment,
  paypalPayment = false,
  acceptedPayments = [],
  loyalty,
}: {
  slug: string;
  currency: string;
  locale: string;
  modes: DrawerModes;
  /** Venue-local "HH:MM" times selectable for later today (server-built
   *  from opening hours). Empty = ASAP-only. */
  requestSlots?: string[];
  /**
   * May the guest still order "Now"? False while the venue is CLOSED: the
   * "Now" chip disappears, a later-today slot is preselected, and dine-in
   * cannot be ordered at all — there is nobody in the room to bring it.
   *
   * Defaults to true so a caller that has not been taught about it (or a
   * venue with no opening hours configured) behaves exactly as before:
   * "we don't know" must never switch a restaurant's ordering off. The
   * server refuses an ASAP or dine-in order while closed regardless
   * (`venue_closed`), so a stale cached page can annoy but never book
   * food nobody will cook.
   */
  acceptsAsapNow?: boolean;
  onlinePayment: boolean;
  paypalPayment?: boolean;
  /**
   * The payment methods the owner ticked in Settings → "Payment methods
   * you accept". The only thing it decides in here is whether a WALLET
   * button may appear: Apple Pay / Google Pay are offered only when the
   * restaurant said it takes them, on top of the existing Stripe-account
   * and device gates. Defaults to `[]` so a caller that has not been
   * taught about it gets NO wallet button rather than an unasked-for one.
   */
  acceptedPayments?: readonly PaymentMethodId[];
  /** Loyalty, round one: absent or disabled = the drawer says nothing
   *  about points, which is the default for every venue. */
  loyalty?: DrawerLoyalty;
}): React.ReactElement | null {
  // Owner intent, read once per render: a wallet the restaurant did not
  // tick is not fetched for, not mounted, and not offered inside the
  // native sheet.
  const wantApplePay = acceptedPayments.includes("apple_pay");
  const wantGooglePay = acceptedPayments.includes("google_pay");
  const lines = useSyncExternalStore(
    subscribeToCart,
    () => getCartSnapshot(slug),
    () => EMPTY_CART,
  );
  const [open, setOpen] = useState(false);
  // Guest-copy locale for links we hand on (receipt PDF, tracker): the
  // venue locale collapsed to a language those surfaces can render.
  const copyLocale = uiLocale(locale);
  /**
   * P7-16 — the drawer is the only guest surface that needs the WHOLE
   * checkout catalogue, so it fetches ONE language on its own chunk
   * instead of importing the five-locale module (which would ship every
   * language to every guest). This runs on mount, long before the guest
   * can add an item, so in practice the copy is in by the time the sheet
   * has anything to show; until then `null` renders the same nothing an
   * empty cart does.
   */
  const [copy, setCopy] = useState<CheckoutCopy | null>(null);
  useEffect(() => {
    let live = true;
    void loadCheckoutCopy(copyLocale).then((c) => {
      if (live) setCopy(c);
    });
    return () => {
      live = false;
    };
  }, [copyLocale]);

  // Bottom-sheet scroll on touch devices: while the sheet is open, lock
  // the page behind it. Without this a swipe on the sheet scrolls the
  // MENU underneath (scroll chaining), which reads as "the cart won't
  // scroll" on phones.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  const enabledTypes = TYPE_META.filter((t) => t.enabled(modes));
  const [orderType, setOrderType] = useState<OrderType>(enabledTypes[0]?.type ?? "dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // Optional, any order type: the receipt (with VAT split) is emailed here.
  const [customerEmail, setCustomerEmail] = useState("");
  // How the guest pays, chosen up front so a single tap places the order
  // AND opens the payment — no second "now pay" screen. Cash is always
  // available; card/PayPal only when the restaurant can take them.
  // P7-13: the list only CHOOSES now, so it needs a sensible default —
  // the first rail the venue actually offers, mirroring the app.
  const [payMethod, setPayMethod] = useState<PayMethod>(
    onlinePayment ? "card" : paypalPayment ? "paypal" : "cash",
  );
  const [street, setStreet] = useState("");
  const [zip, setZip] = useState("");
  const [note, setNote] = useState("");
  // "" = as soon as possible; otherwise a venue-local HH:MM from
  // requestSlots. The server re-validates against opening hours.
  const [requestedTime, setRequestedTime] = useState("");
  const [placing, setPlacing] = useState(false);
  const [payStarting, setPayStarting] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  // Survives re-renders so a retry reuses the same idempotency key.
  const attemptRef = useRef<{ key: string; signature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The guest asked to edit a delivery address the drawer had already
   *  prefilled. Sticky for the session: once the fields are open they stay
   *  open, so a half-typed change can't be swallowed by a re-render. */
  const [editingAddress, setEditingAddress] = useState(false);
  /** Answered by `/api/v1/pay/wallet-config` the first time the sheet
   *  opens on a venue that takes card. null = not asked yet. */
  const [wallet, setWallet] = useState<WalletConfig | null>(null);
  /** A wallet charge already settled this order, so the confirmation
   *  screen must not offer to charge it again. */
  const [walletPaid, setWalletPaid] = useState(false);
  /** The order the wallet flow placed, held until that flow resolves —
   *  see `placeOrderOnServer(…, false)`. */
  const walletOrderRef = useRef<PlacedOrder | null>(null);

  /**
   * Is there a wallet to offer at all? The key is public, but it only
   * exists when a REAL Stripe account is behind the venue, so this single
   * fetch is also the "can this deployment take a card right now" answer.
   * Behind `open` because the menu page is static and edge-cached, and
   * behind the owner's tick-boxes because a venue that offers neither
   * wallet has nothing to do with the answer.
   */
  useEffect(() => {
    if (!open || !onlinePayment || (!wantApplePay && !wantGooglePay) || wallet !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/pay/wallet-config");
        if (!res.ok) return;
        const body = (await res.json()) as Partial<WalletConfig> | null;
        if (cancelled || !body) return;
        setWallet({
          publishableKey: body.publishableKey ?? null,
          applePay: Boolean(body.applePay),
          country: body.country ?? "DE",
        });
      } catch {
        // Offline or a non-JSON body: no wallet button, everything else
        // in the sheet keeps working.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onlinePayment, wantApplePay, wantGooglePay, wallet]);

  /**
   * Prefill from the signed-in customer, once, the first time the sheet
   * opens (plan decision 10).
   *
   * Deliberately not on render: the menu page is static and edge-cached,
   * so the profile read has to be a client-side effect behind a guest
   * action. It reads no cookie itself — the browser attaches the session
   * cookie to a same-origin request — and writes nothing to storage.
   * Not signed in (401), offline, or a response without the newer fields:
   * nothing happens and the guest types as before.
   */
  // null = not asked yet. The loyalty line stays hidden until we know,
  // rather than flashing "sign in" at someone who already is.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  /** The signed-in guest's last delivery address came back from the
   *  profile — that, not "the fields happen to be full", is what makes an
   *  address worth summarising as a card (P7-13). */
  const [savedAddress, setSavedAddress] = useState(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!open || prefilled.current) return;
    prefilled.current = true;
    let cancelled = false;
    const fillIfEmpty = (setter: Dispatch<SetStateAction<string>>, value: unknown): void => {
      if (cancelled || typeof value !== "string" || !value.trim()) return;
      const next = value.trim();
      setter((prev) => (prev.trim() ? prev : next));
    };
    void (async () => {
      try {
        const res = await fetch("/api/v1/me", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setSignedIn(false);
          return;
        }
        const body = (await res.json()) as { customer?: CustomerProfile } | null;
        const me = body?.customer;
        if (!cancelled) setSignedIn(Boolean(me));
        if (!me) return;
        fillIfEmpty(setCustomerName, me.name);
        fillIfEmpty(setCustomerEmail, me.email);
        fillIfEmpty(setCustomerPhone, me.phone);
        const addr = me.lastDeliveryAddress;
        if (!addr) return;
        fillIfEmpty(setStreet, addr.street);
        fillIfEmpty(setNote, addr.note);
        // Only when the ZIP is one this venue actually delivers to —
        // otherwise the <select> would carry a value with no option.
        const zipKnown =
          modes.deliveryAreas.length === 0 ||
          modes.deliveryAreas.some((a) => a.zip === addr.zip?.trim());
        if (zipKnown) fillIfEmpty(setZip, addr.zip);
        // P7-13: only an address the ACCOUNT already knows earns the
        // summary card. Deriving "we know it" from the fields being full
        // would collapse the form under a first-time guest the moment
        // they finished typing their ZIP.
        if (!cancelled && zipKnown && addr.street?.trim() && addr.zip?.trim()) {
          setSavedAddress(true);
        }
      } catch {
        // Offline, blocked, or a non-JSON body — the form stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, modes.deliveryAreas]);

  /**
   * Fulfilment time (P7-13): two radios, then a ± stepper over the
   * server's own slot list. "" is ASAP; anything else must BE one of the
   * offered slots. Derived rather than corrected in an effect, so a slot
   * list that changes under the guest (opening hours rolled over while
   * the sheet sat open) simply reads as ASAP — and `scheduled` is also
   * what the submit payload consults, so a time the server no longer
   * offers can never be sent.
   */
  /**
   * The time the order is actually FOR. Normally whatever the guest
   * picked; while the venue is closed, "Now" is not on offer, so an empty
   * (or stale) choice reads as the first later-today slot instead —
   * derived rather than written back by an effect, so a slot list that
   * changes under the guest can never leave the sheet holding a time the
   * server no longer sells.
   */
  const effectiveTime =
    acceptsAsapNow || requestSlots.includes(requestedTime)
      ? requestedTime
      : (requestSlots[0] ?? "");
  const slotIndex = requestSlots.indexOf(effectiveTime);
  const scheduled = effectiveTime !== "" && slotIndex >= 0;
  /** Closed and dine-in: not a choice the guest can make. Nobody is in
   *  the room, so the button says so instead of failing on submit. */
  const dineInClosed = !acceptsAsapNow && orderType === "dine_in";

  const count = cartCount(lines);
  const itemsTotal = cartTotalCents(lines);
  // Per-ZIP delivery areas: the selected row sets fee + minimum (fee
  // drops to 0 past its free-delivery threshold). No areas configured →
  // the venue's flat fee/minimum applies to any address. Display only —
  // the server re-derives all of this from the submitted ZIP.
  const hasAreas = modes.deliveryAreas.length > 0;
  const selectedArea = hasAreas ? modes.deliveryAreas.find((a) => a.zip === zip) : undefined;
  const areaFee = selectedArea
    ? selectedArea.freeOverCents > 0 && itemsTotal >= selectedArea.freeOverCents
      ? 0
      : selectedArea.feeCents
    : hasAreas
      ? 0
      : modes.deliveryFeeCents;
  const areaMin = selectedArea?.minCents ?? (hasAreas ? 0 : modes.deliveryMinCents);
  const feeCents = orderType === "delivery" ? areaFee : 0;
  const total = itemsTotal + feeCents;
  const belowMinimum = orderType === "delivery" && itemsTotal < areaMin;
  const detailsMissing =
    orderType === "dine_in"
      ? false
      : !customerName.trim() ||
        !customerPhone.trim() ||
        (orderType === "delivery" &&
          (!street.trim() || !zip.trim() || (hasAreas && !selectedArea)));
  const money = (cents: number): string => formatCents(cents, currency, locale);
  // Points are earned on the FOOD subtotal — 5 per full €20 at the
  // defaults (`pointsForFood`) — and the delivery fee never counts, which
  // is why this reads `itemsTotal`, not `total`.
  const earnedPoints = loyalty?.enabled ? pointsForFood(loyalty, itemsTotal) : 0;
  const earnsPoints = earnedPoints > 0;
  const loyaltyPoints = String(earnedPoints);
  /** Is there a delivery address to SHOW rather than ask for? A returning
   *  guest gets the card with a "Change" link; a new one gets the fields
   *  straight away, because a card summarising nothing is just a gap. */
  const hasAddress = savedAddress && street.trim().length > 0 && zip.trim().length > 0;
  const addressFieldsOpen = editingAddress || !hasAddress;
  const busy = placing || payStarting;
  /** Nothing may be placed or paid: no items, missing details, under the
   *  delivery minimum, or a payment already running. */
  const payBlocked =
    busy ||
    count === 0 ||
    detailsMissing ||
    belowMinimum ||
    dineInClosed ||
    // Closed with no later slot left today: there is no time this order
    // could be for, so there is nothing to place.
    (!acceptsAsapNow && orderType !== "dine_in" && !scheduled);

  // Nothing to show: empty cart, or the locale's copy hasn't landed yet.
  if (copy === null || (count === 0 && !placed)) return null;
  const t = copy;

  /** Step one slot along the server's list. Never wraps — `disabled` at
   *  the ends does the talking. */
  function stepSlot(delta: number): void {
    const next = requestSlots[slotIndex + delta];
    if (next !== undefined) setRequestedTime(next);
  }

  /** Save the PDF receipt without leaving the page — a hidden anchor with
   *  `download`, clicked inside the guest's own tap so browsers allow it. */
  function downloadReceipt(order: PlacedOrder): void {
    const a = document.createElement("a");
    a.href = `/api/orders/${order.orderId}/receipt?token=${encodeURIComponent(order.receiptToken)}&locale=${copyLocale}`;
    a.download = `receipt-${String(order.orderNumber).padStart(4, "0")}.pdf`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Open the hosted payment page for a placed order. Resolves (without
   *  navigating) when the payment could not be started, so the caller can
   *  fall back to the confirmation screen. */
  async function startPayment(
    order: PlacedOrder,
    method: Exclude<PayMethod, "cash">,
  ): Promise<void> {
    setPayStarting(true);
    try {
      const path = method === "paypal" ? "pay/paypal" : "pay";
      const res = await fetch(`/api/orders/${order.orderId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: order.receiptToken }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (res.ok && body?.url) {
        // `assign` rather than `location.href =`: the same navigation, but
        // a call the lint rules don't read as mutating a global.
        window.location.assign(body.url);
        return; // keep the button busy while the page unloads
      }
      setError(method === "paypal" ? t.errPaypalOpen : t.errCardOpen);
    } catch {
      setError(t.errPayRetry);
    }
    setPayStarting(false);
  }

  /** Move the sheet to its confirmation screen for a placed order. Split
   *  out because the wallet flow defers it: the Apple Pay / Google Pay
   *  sheet is still open while the order is being saved, and swapping the
   *  page behind it would unmount the very button driving the payment. */
  function commitPlaced(value: PlacedOrder): void {
    setPlaced(value);
    clearCart(slug);
    setOpen(true);
  }

  /**
   * Save the order. `commit` is false for the wallet path only — there
   * the order is real from this moment, but the guest is still looking at
   * the wallet sheet, so the confirmation screen waits for the charge to
   * resolve (success or failure) before it appears.
   */
  async function placeOrderOnServer(method: PayMethod, commit = true): Promise<PlacedOrder | null> {
    setPlacing(true);
    setError(null);
    try {
      const payload = {
        slug,
        orderType,
        requestedTime: orderType !== "dine_in" && scheduled ? effectiveTime : undefined,
        tableNumber: orderType === "dine_in" ? tableNumber.trim() || undefined : undefined,
        customerName: orderType === "dine_in" ? undefined : customerName.trim(),
        customerPhone: orderType === "dine_in" ? undefined : customerPhone.trim(),
        customerEmail: customerEmail.trim() || undefined,
        intendedPayment: method,
        address:
          orderType === "delivery"
            ? {
                street: street.trim(),
                zip: zip.trim(),
                // City comes from the venue's area row for this ZIP —
                // the server patches it authoritatively.
                note: note.trim() || undefined,
              }
            : undefined,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      };

      // Idempotency key for this submit. A lost response looks exactly
      // like a failure here (the `catch` below), so the guest's natural
      // reaction — tap again — would otherwise place a SECOND real order
      // and the kitchen would cook it twice. Reusing the key makes the
      // retry return the first order.
      //
      // Keyed to the payload: change anything about the basket and a
      // fresh key is minted, so an edited order is never answered with
      // the previous one. Cleared on success.
      const signature = JSON.stringify(payload);
      if (!attemptRef.current || attemptRef.current.signature !== signature) {
        attemptRef.current = { key: newRequestId(), signature };
      }

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, clientRequestId: attemptRef.current.key }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          body?.error === "unknown_items"
            ? t.errUnknownItems
            : body?.error === "rate_limited"
              ? t.errRateLimited
              : body?.error === "type_not_available"
                ? t.errTypeNotAvailable
                : body?.error === "outside_delivery_area"
                  ? t.errOutsideArea
                  : body?.error === "below_delivery_minimum"
                    ? t.errBelowMinimum(money(areaMin))
                    : body?.error === "invalid_time"
                      ? t.errInvalidTime
                      : body?.error === "venue_closed"
                        ? t.errVenueClosed
                        : t.errGeneric,
        );
        return null;
      }
      const value = (await res.json()) as PlacedOrder;
      // Landed — retire the key so the guest's next basket is a new order.
      attemptRef.current = null;
      // Remembered HERE rather than in `commitPlaced`, because the wallet
      // path defers that call until the charge resolves: the order is real
      // from this moment either way, and a guest whose wallet payment
      // failed still needs the way back to it.
      rememberOrder(slug, {
        orderId: value.orderId,
        receiptToken: value.receiptToken,
        placedAt: new Date().toISOString(),
      });
      if (commit) commitPlaced(value);
      return value;
    } catch {
      setError(t.errNoConnection);
      return null;
    } finally {
      setPlacing(false);
    }
  }

  /** The ordinary path: place, then open the payment page (card/PayPal)
   *  or hand over the receipt (cash). */
  async function submitOrder(method: PayMethod): Promise<void> {
    setPayMethod(method);
    const value = await placeOrderOnServer(method);
    if (!value) return;
    // Card / PayPal: go straight to the payment page. If that hop fails
    // the confirmation screen below still offers the pay buttons, so
    // the order is never stranded.
    if (method !== "cash") await startPayment(value, method);
    // Cash: the order is final now — hand over the receipt straight away.
    else downloadReceipt(value);
  }

  const receiptHref = placed
    ? `/api/orders/${placed.orderId}/receipt?token=${encodeURIComponent(placed.receiptToken)}&locale=${copyLocale}`
    : "#";
  const trackHref = placed
    ? `/order-status/${placed.orderId}?token=${encodeURIComponent(placed.receiptToken)}&locale=${copyLocale}`
    : "#";
  /** Whether the confirmation screen already has a dominant pay CTA. When it
   *  doesn't, "Track your order" is the primary action and takes that weight.
   *  A wallet charge that went through leaves nothing to pay, so the pay
   *  CTAs disappear and Track takes over. */
  const hasPaymentCta = (onlinePayment || paypalPayment) && !walletPaid;

  return (
    /* `dir` here as well as on <html>: the sheet is a fixed overlay, and
       this keeps it mirrored even if it is ever portalled elsewhere. */
    <div className="menu-theme" dir={dirFor(locale)}>
      {/* Floating bar */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            // The surface accent (gold on the Rangla theme) with surface ink,
            // so the button stands out from the dark footer and cards it
            // floats over (owner, 2026-09-21).
            "menu-pop fixed bottom-4 end-4 z-30 flex items-center gap-3 rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-5 py-3 text-sm font-semibold text-[var(--menu-surface,var(--menu-bg))] shadow-[0_18px_36px_-12px_rgba(0,0,0,0.55)] ring-2 ring-black/10 transition-transform hover:scale-[1.03] active:scale-95 " +
            FOCUS_RING
          }
        >
          {placed ? (
            <span>{t.placedBadge(String(placed.orderNumber))}</span>
          ) : (
            <>
              <span className="relative inline-flex" aria-hidden="true">
                <CartIcon className="h-5 w-5" />
                <span className="absolute -end-2.5 -top-2 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-[var(--menu-surface)] px-1 text-[10px] font-bold leading-none text-[var(--menu-surface-text,var(--menu-text))]">
                  {count}
                </span>
              </span>
              <span className="ms-1">{t.yourOrder}</span>
              {/* Ink, not accent: 14px semibold in accent is 3.28:1 on
                  fresh-bistro. Gold is reserved for the TOTAL. */}
              <span className="font-semibold">{money(total)}</span>
            </>
          )}
        </button>
      ) : null}

      {/* Drawer */}
      {open ? (
        <div
          role="dialog"
          aria-label={t.yourOrder}
          /* The ONE surviving four-sided border, re-based from `--menu-line` to
             ink/10: a dark sheet on a dark ground needs an edge and the shadow
             alone will not carry it, but it must be the same faint step off the
             surface on every theme rather than a gold rule on one. */
          className="menu-sheet fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[85vh] w-full max-w-lg touch-pan-y overflow-y-auto overscroll-contain rounded-t-2xl supports-[height:100dvh]:max-h-[85dvh] border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] p-5 text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_-24px_48px_-24px_rgba(0,0,0,0.55)] sm:bottom-4 sm:end-4 sm:mx-0 sm:ms-auto sm:rounded-2xl"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2.5 font-serif text-2xl">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))]/14"
              >
                <CartIcon className="h-4.5 w-4.5 text-[var(--menu-surface-accent,var(--menu-accent))]" />
              </span>
              {placed ? t.headingPlaced(String(placed.orderNumber)) : t.yourOrder}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.close}
              className={ICON_BTN}
            >
              ✕
            </button>
          </div>

          {placed ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                {t.placedIntro}{" "}
                <span className="font-semibold text-[var(--menu-surface-text,var(--menu-text))]">
                  {t.placedRef(String(placed.orderNumber))}
                </span>
                {tableNumber.trim() ? t.placedForTable(tableNumber.trim()) : ""}. {t.total}{" "}
                {/* Ink, not accent: 14px semibold, same 3.28:1 reason. */}
                <span className="font-semibold text-[var(--menu-surface-text,var(--menu-text))]">
                  {money(placed.totalCents)}
                </span>{" "}
                ({t.vatIncluded(VAT_RATE_LABEL, money(vatFromGross(placed.totalCents)))})
                {payMethod === "cash" ? t.placedCashTail : "."}
                {customerEmail.trim()
                  ? t.placedEmailTail(customerEmail.trim(), payMethod !== "cash")
                  : ""}
              </p>
              {error ? <MessagePopup kind="error" text={error} /> : null}
              {onlinePayment && placed && !walletPaid ? (
                <button
                  type="button"
                  disabled={payStarting}
                  onClick={() => void startPayment(placed, "card")}
                  className={CTA_PAY}
                >
                  {payStarting ? t.openingPayment : t.payOnline(money(placed.totalCents))}
                </button>
              ) : null}
              {paypalPayment && placed && !walletPaid ? (
                <button
                  type="button"
                  disabled={payStarting}
                  onClick={() => void startPayment(placed, "paypal")}
                  /* DELIBERATE EXCEPTION to everything above: PayPal's brand
                     guidelines mandate this yellow/navy button, so it is the
                     only hard-coded hex in the file and the only four-sided
                     border besides the sheet's own edge. Do not "theme" it. */
                  className={
                    "block w-full rounded-full border-2 border-[#003087] bg-[#ffc439] px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-[#003087] transition hover:opacity-90 active:scale-[0.985] disabled:opacity-60" +
                    RTL_TYPE +
                    " " +
                    FOCUS_RING
                  }
                >
                  {payStarting ? t.openingPaypal : t.payWithPaypal}
                </button>
              ) : null}
              {/* One dominant fill, then a wash, then text links. This stack
                  used to be four solid fills plus an outline, so nothing led
                  and the PDF download shouted as loudly as paying. Track is
                  promoted to primary only when there is nothing left to pay. */}
              <a href={trackHref} className={hasPaymentCta ? CTA_SECONDARY : CTA_PRIMARY}>
                {t.trackOrder}
              </a>
              <a href={receiptHref} className={CTA_LINK}>
                {t.downloadReceipt}
              </a>
              <button
                type="button"
                onClick={() => {
                  setPlaced(null);
                  setTableNumber("");
                  setOpen(false);
                }}
                className={CTA_LINK}
              >
                {t.startNewOrder}
              </button>
            </div>
          ) : (
            <>
              {/* No dividers. Rows are separated by proximity instead: the
                  inter-row gap (16px) is more than twice the largest gap inside
                  a row, the tinted qty cluster anchors each one, and the price
                  sits on the end edge. A faint hairline was the alternative and it
                  composites to ~1.15:1 — the same mush this replaced, and the
                  first thing to disappear on a phone in daylight. */}
              <ul className="mt-4 space-y-4">
                {lines.map((line) => (
                  <li key={line.itemId} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                        {t.each(money(line.priceCents))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={t.oneLess(line.name)}
                        onClick={() => setQuantity(slug, line.itemId, line.quantity - 1)}
                        className={ICON_BTN + " text-base leading-none"}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label={t.oneMore(line.name)}
                        onClick={() => setQuantity(slug, line.itemId, line.quantity + 1)}
                        className={ICON_BTN + " text-base leading-none"}
                      >
                        +
                      </button>
                    </div>
                    {/* Ink, not accent — 14px semibold accent is 3.28:1 on
                        fresh-bistro, and reserving gold for the TOTAL alone
                        makes the total read as the summary it is. */}
                    <p className="w-20 text-end text-sm font-semibold tabular-nums">
                      {money(line.priceCents * line.quantity)}
                    </p>
                    {/* Remove the whole line in one tap — quicker than
                        stepping the quantity down to zero. */}
                    <button
                      type="button"
                      aria-label={t.removeLine(line.name)}
                      title={t.remove}
                      onClick={() => setQuantity(slug, line.itemId, 0)}
                      className={ROW_DELETE_BTN}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        className="h-4 w-4"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Kept — a summary rule is not a peer divider, and it is now the
                  only line in the list region. Re-based to ink/12 so it is
                  actually visible on all 19 themes instead of 1.2:1 on 17. */}
              <div className="mt-4 flex items-center justify-between border-t border-[var(--menu-surface-text,var(--menu-text))]/12 pt-3">
                <span className="text-sm uppercase tracking-[0.18em] rtl:normal-case rtl:tracking-normal text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  {t.total}
                </span>
                <span className="font-serif text-2xl font-semibold text-[var(--menu-surface-accent,var(--menu-accent))]">
                  {money(total)}
                </span>
              </div>
              <p className="mt-1 text-end text-[11px] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                {t.vatIncluded(VAT_RATE_LABEL, money(vatFromGross(total)))}
              </p>
              {earnsPoints && signedIn !== null ? (
                <p className="mt-1.5 text-end text-[11px] text-[var(--menu-surface-accent,var(--menu-accent))]">
                  {signedIn ? (
                    <>★ {t.loyaltyEarn(loyaltyPoints)}</>
                  ) : (
                    <Link
                      href="/account"
                      className="underline decoration-1 underline-offset-4 hover:opacity-80"
                    >
                      ★ {t.loyaltySignIn(loyaltyPoints)}
                    </Link>
                  )}
                </p>
              ) : null}

              {/* Cart actions: empty the whole order, or hop back to the
                  menu to add more — both icon + label, no-JS-safe. */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => clearCart(slug)} className={DANGER_BTN}>
                  <TrashIcon className="h-4 w-4" />
                  {t.clearCart}
                </button>
                <button type="button" onClick={() => setOpen(false)} className={QUIET_BTN}>
                  <PlusIcon className="h-4 w-4" />
                  {t.addItems}
                </button>
              </div>

              {enabledTypes.length > 1 ? (
                <div
                  role="radiogroup"
                  aria-label={t.orderTypeGroup}
                  /* Was a hardcoded grid-cols-3, so two enabled modes rendered
                     at a third of the width beside a dead column. Both literals
                     must appear in source for Tailwind to emit them. */
                  className={
                    enabledTypes.length === 2
                      ? "mt-4 grid grid-cols-2 gap-2"
                      : "mt-4 grid grid-cols-3 gap-2"
                  }
                >
                  {enabledTypes.map((mode) => (
                    <button
                      key={mode.type}
                      type="button"
                      role="radio"
                      aria-checked={orderType === mode.type}
                      onClick={() => setOrderType(mode.type)}
                      className={orderType === mode.type ? CHIP_ON : CHIP_IDLE}
                    >
                      <span aria-hidden="true" className="block text-base">
                        {mode.icon}
                      </span>
                      {t[mode.label]}
                      {/* Selection needs three simultaneous signals, because the
                          wash alone is 1.17:1 against the surface and 1.4.1
                          forbids color as the only carrier: hue (accent wash vs
                          neutral), weight (semibold), and this solid bar, which
                          carries the ≥3:1 state contrast as a FILL rather than a
                          border. Reads as a segmented control. */}
                      {orderType === mode.type ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--menu-surface-accent,var(--menu-accent))]"
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {dineInClosed ? (
                /* Closed: ordering at a table nobody is standing at is not
                   a thing the guest can do, and the place-order button is
                   disabled to match. */
                <p
                  role="status"
                  className="mt-3 text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
                >
                  {t.closedDineIn}
                </p>
              ) : null}
              {orderType === "dine_in" ? (
                <label className="mt-3 block text-sm">
                  <span className={FIELD_LABEL}>{t.tableNumber}</span>
                  <input
                    type="text"
                    value={tableNumber}
                    maxLength={20}
                    onChange={(e) => setTableNumber(e.target.value)}
                    placeholder={t.tableNumberPlaceholder}
                    className={FIELD}
                  />
                </label>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className={FIELD_LABEL}>
                      {t.yourName}
                      <RequiredMark label={t.requiredMark} />
                    </span>
                    <input
                      type="text"
                      value={customerName}
                      maxLength={80}
                      required
                      onChange={(e) => setCustomerName(e.target.value)}
                      className={FIELD}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className={FIELD_LABEL}>
                      {t.phone}
                      <RequiredMark label={t.requiredMark} />
                    </span>
                    <input
                      type="tel"
                      value={customerPhone}
                      maxLength={30}
                      required
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder={t.phonePlaceholder}
                      className={FIELD}
                    />
                  </label>
                  {requestSlots.length > 0 ? (
                    /* P7-13 — "Now" / "Scheduled", then a ± stepper over
                       the server's own slot list, replacing a <select>
                       whose 30-odd identical-looking times were a scroll,
                       not a choice. No free typing and no wrapping: the
                       slots are later-today times inside opening hours
                       (the server re-checks anyway). */
                    <div className="block text-sm sm:col-span-2">
                      <span className={FIELD_LABEL}>
                        {orderType === "delivery" ? t.deliveryTime : t.pickupTime}
                      </span>
                      <div
                        role="radiogroup"
                        aria-label={orderType === "delivery" ? t.deliveryTime : t.pickupTime}
                        className={`mt-1 grid gap-2 ${acceptsAsapNow ? "grid-cols-2" : "grid-cols-1"}`}
                      >
                        {/* "Now" exists only while the kitchen is open.
                            Hidden rather than disabled: a dead chip invites
                            a tap and explains nothing, while the note below
                            says what IS possible. */}
                        {acceptsAsapNow ? (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!scheduled}
                            onClick={() => setRequestedTime("")}
                            className={!scheduled ? TIME_CHIP_ON : TIME_CHIP_IDLE}
                          >
                            {t.timeNow}
                            {!scheduled ? (
                              <span
                                aria-hidden="true"
                                className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--menu-surface-accent,var(--menu-accent))]"
                              />
                            ) : null}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={scheduled}
                          onClick={() => {
                            if (!scheduled) setRequestedTime(requestSlots[0] ?? "");
                          }}
                          className={scheduled ? TIME_CHIP_ON : TIME_CHIP_IDLE}
                        >
                          {t.timeScheduled}
                          {scheduled ? (
                            <span
                              aria-hidden="true"
                              className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--menu-surface-accent,var(--menu-accent))]"
                            />
                          ) : null}
                        </button>
                      </div>
                      {scheduled ? (
                        <div className="mt-2 flex items-center gap-2 rounded-xl bg-[var(--menu-surface-text,var(--menu-text))]/7 p-1.5">
                          <button
                            type="button"
                            aria-label={t.timeEarlier}
                            disabled={slotIndex <= 0}
                            onClick={() => stepSlot(-1)}
                            className={STEP_BTN}
                          >
                            −
                          </button>
                          {/* The value itself is what changes, so it is
                              announced rather than the buttons' labels. */}
                          <span
                            aria-live="polite"
                            className="flex-1 text-center text-base font-semibold tabular-nums"
                          >
                            {effectiveTime}
                          </span>
                          <button
                            type="button"
                            aria-label={t.timeLater}
                            disabled={slotIndex >= requestSlots.length - 1}
                            onClick={() => stepSlot(1)}
                            className={STEP_BTN}
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                          {t.asap}
                        </p>
                      )}
                    </div>
                  ) : null}
                  {/* One line whenever the venue is shut: it is the only
                      thing that explains why "Now" is not there — and,
                      when no later slot is left today either, why the
                      place-order button will not move. */}
                  {acceptsAsapNow ? null : (
                    <p
                      role="status"
                      className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))] sm:col-span-2"
                    >
                      {t.closedPreorderNote}
                    </p>
                  )}
                </div>
              )}
              <label className="mt-3 block text-sm">
                <span className={FIELD_LABEL}>{t.email}</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={customerEmail}
                  maxLength={120}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  className={FIELD}
                />
              </label>

              {orderType === "delivery" ? (
                <div className="mt-3 space-y-3">
                  {/* P7-13 — a returning guest's address, prefilled from
                      their account, reads as a card with one "Change"
                      link instead of four open fields they have to check
                      character by character. A new guest never sees the
                      card: summarising nothing is just a gap. */}
                  {!addressFieldsOpen ? (
                    <div className="flex items-start justify-between gap-3 rounded-xl bg-[var(--menu-surface-text,var(--menu-text))]/7 p-3">
                      <div className="min-w-0 text-sm">
                        <p
                          className={
                            FIELD_LABEL +
                            " text-[11px] uppercase tracking-[0.14em] rtl:normal-case rtl:tracking-normal"
                          }
                        >
                          {t.addressTitle}
                        </p>
                        <p className="mt-1 truncate font-medium">{street.trim()}</p>
                        <p className="truncate">
                          {[zip.trim(), selectedArea?.locality ?? ""].filter(Boolean).join(" ")}
                        </p>
                        {note.trim() ? (
                          <p className="truncate text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                            {note.trim()}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingAddress(true)}
                        aria-label={`${t.addressChange} — ${t.addressTitle}`}
                        className={CHANGE_BTN}
                      >
                        {t.addressChange}
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="block text-sm">
                        <span className={FIELD_LABEL}>
                          {t.street}
                          <RequiredMark label={t.requiredMark} />
                        </span>
                        <input
                          type="text"
                          value={street}
                          maxLength={120}
                          required
                          onChange={(e) => setStreet(e.target.value)}
                          className={FIELD}
                        />
                      </label>
                      {modes.deliveryAreas.length > 0 ? (
                        <div className="grid grid-cols-[minmax(0,130px)_1fr] gap-3">
                          <label className="block text-sm">
                            <span className={FIELD_LABEL}>
                              {t.zip}
                              <RequiredMark label={t.requiredMark} />
                            </span>
                            {/* The restaurant delivers to a fixed ZIP list, so
                            the guest PICKS their area instead of typing —
                            "do you deliver here?" answers itself. */}
                            <select
                              value={zip}
                              required
                              onChange={(e) => setZip(e.target.value)}
                              className={FIELD_SELECT}
                            >
                              <option value="" disabled>
                                {t.selectPlaceholder}
                              </option>
                              {modes.deliveryAreas.map((a) => (
                                <option key={a.zip} value={a.zip}>
                                  {a.zip}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-sm">
                            <span className={FIELD_LABEL}>{t.city}</span>
                            {/* Filled automatically from the selected ZIP — the
                            restaurant named this area, the guest never
                            types it. */}
                            <input
                              type="text"
                              value={selectedArea?.locality ?? ""}
                              readOnly
                              tabIndex={-1}
                              placeholder={t.cityPlaceholder}
                              className={FIELD_READONLY}
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="block max-w-[150px] text-sm">
                          <span className={FIELD_LABEL}>
                            {t.zip}
                            <RequiredMark label={t.requiredMark} />
                          </span>
                          <input
                            type="text"
                            value={zip}
                            maxLength={10}
                            required
                            onChange={(e) => setZip(e.target.value)}
                            className={FIELD}
                          />
                        </label>
                      )}
                      <label className="block text-sm">
                        <span className={FIELD_LABEL}>{t.deliveryNote}</span>
                        <input
                          type="text"
                          value={note}
                          maxLength={200}
                          placeholder={t.deliveryNotePlaceholder}
                          onChange={(e) => setNote(e.target.value)}
                          className={FIELD}
                        />
                      </label>
                    </>
                  )}
                  {/* Outside the card/fields switch: the fee, the free-
                      delivery threshold and the minimum are facts about
                      the order, not about whether the guest happens to be
                      editing their address. */}
                  {selectedArea && selectedArea.freeOverCents > 0 ? (
                    <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      {itemsTotal >= selectedArea.freeOverCents
                        ? t.freeDeliveryHere
                        : t.freeDeliveryFrom(money(selectedArea.freeOverCents))}
                    </p>
                  ) : null}
                  {feeCents > 0 ? (
                    <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      {t.deliveryFee(money(feeCents))}
                      {areaMin > 0 ? t.minimumOrderSuffix(money(areaMin)) : ""}
                    </p>
                  ) : areaMin > 0 ? (
                    <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      {t.minimumOrder(money(areaMin))}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* One legend for the whole details block. Dine-in has no
                  required field at all — the table number is optional —
                  so it gets no star and no line to explain one. */}
              {orderType === "dine_in" ? null : (
                <RequiredLegend
                  label={t.requiredLegend}
                  className="mt-3 text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]"
                />
              )}

              {error ? <MessagePopup kind="error" text={error} /> : null}

              {/* P7-13 — the wallet first, then the list, then one CTA.
                  The three tiles this replaced each PLACED the order on
                  tap, so choosing a method and committing to it were the
                  same gesture and Apple Pay had nowhere to live that did
                  not read as a fourth, differently-behaved tile. */}
              {(() => {
                const cashLabel =
                  orderType === "delivery"
                    ? t.cashToDriver
                    : orderType === "takeaway"
                      ? t.payAtPickup
                      : t.payAtTable;
                const options: { key: PayMethod; label: string; marks: PaymentMethodId[] }[] = [
                  ...(onlinePayment
                    ? [
                        {
                          key: "card" as const,
                          label: t.card,
                          marks: ["visa", "mastercard"] as PaymentMethodId[],
                        },
                      ]
                    : []),
                  ...(paypalPayment
                    ? [
                        {
                          key: "paypal" as const,
                          label: t.paypal,
                          marks: ["paypal"] as PaymentMethodId[],
                        },
                      ]
                    : []),
                  { key: "cash" as const, label: cashLabel, marks: [] },
                ];
                return (
                  <div className="mt-4">
                    {/* Apple Pay / Google Pay: one tap places AND pays.
                        Drawn ONLY when the OWNER ticked that wallet in
                        settings AND the browser, the venue's Stripe
                        account and (for Apple) the verified merchant
                        domain all agree — otherwise nothing at all is
                        rendered here, not a disabled button. */}
                    {onlinePayment && wallet?.publishableKey && (wantApplePay || wantGooglePay) ? (
                      <>
                        <WalletPayButton
                          publishableKey={wallet.publishableKey}
                          allowApplePay={wallet.applePay && wantApplePay}
                          allowGooglePay={wantGooglePay}
                          country={wallet.country}
                          currency={currency}
                          totalCents={total}
                          label={t.yourOrder}
                          disabled={payBlocked}
                          errorText={t.errWalletPay}
                          placeOrder={async () => {
                            setPayMethod("card");
                            const value = await placeOrderOnServer("card", false);
                            walletOrderRef.current = value;
                            return value
                              ? { orderId: value.orderId, receiptToken: value.receiptToken }
                              : null;
                          }}
                          onPaid={() => {
                            const value = walletOrderRef.current;
                            if (!value) return;
                            setWalletPaid(true);
                            commitPlaced(value);
                            downloadReceipt(value);
                          }}
                          onError={(message) => {
                            setError(message);
                            // The order IS placed — show the confirmation
                            // screen so its pay buttons can finish the job.
                            const value = walletOrderRef.current;
                            if (value) commitPlaced(value);
                          }}
                        />
                        {options.length > 1 ? (
                          <p className="mt-2 text-center text-[11px] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                            {t.payOrChoose}
                          </p>
                        ) : null}
                      </>
                    ) : null}

                    {/* One row per method. A single option is not a choice
                        — the CTA and the explainer below already say what
                        will happen — so the list only appears when there
                        is something to pick. */}
                    {options.length > 1 ? (
                      <div className="mt-3">
                        <p className={FIELD_LABEL + " text-sm"}>{t.paymentMethod}</p>
                        <div
                          role="radiogroup"
                          aria-label={t.paymentMethod}
                          className="mt-1.5 space-y-2"
                        >
                          {options.map((option) => {
                            const on = payMethod === option.key;
                            return (
                              <button
                                key={option.key}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setPayMethod(option.key)}
                                className={on ? PAY_ROW_ON : PAY_ROW_IDLE}
                              >
                                <RadioDot on={on} />
                                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                {/* Decorative: the row already says what
                                    it is, so the marks are not a second
                                    thing for a screen reader to read. */}
                                <span aria-hidden="true" className="shrink-0">
                                  {option.marks.length > 0 ? (
                                    <PaymentMarks ids={option.marks} />
                                  ) : (
                                    <CashIcon className="h-6 w-6 text-[var(--menu-surface-text-soft,var(--menu-text-soft))]" />
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      disabled={payBlocked}
                      onClick={() => void submitOrder(payMethod)}
                      className={"mt-3 " + (payMethod === "cash" ? CTA_PRIMARY : CTA_PAY)}
                    >
                      {busy
                        ? payMethod === "cash"
                          ? t.placing
                          : t.opening
                        : `${payMethod === "cash" ? t.placeOrder : t.pay} · ${money(total)}`}
                    </button>
                  </div>
                );
              })()}
              {belowMinimum ? (
                <p className="mt-2 text-center text-[11px] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  {t.belowMinimum(money(areaMin), money(areaMin - itemsTotal))}
                </p>
              ) : (
                <p className="mt-2 text-center text-[11px] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  {onlinePayment || paypalPayment
                    ? t.explainerOnline
                    : orderType === "delivery"
                      ? t.explainerDelivery
                      : orderType === "takeaway"
                        ? t.explainerPickup
                        : t.explainerDineIn}
                </p>
              )}
              {/* The brands the enabled rails can actually charge, on the
                  card the guest is about to tap: a guest who cannot see a
                  Visa mark assumes their card is not taken. Stripe implies
                  Visa / Mastercard / Amex; PayPal appears on its own rail. */}
              {onlinePayment || paypalPayment ? (
                <div className="mt-3 flex flex-col items-center gap-1.5">
                  <span className="text-center text-[11px] font-medium text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                    {t.securedBy(
                      [onlinePayment ? "Stripe" : null, paypalPayment ? "PayPal" : null]
                        .filter(Boolean)
                        .join(" / "),
                    )}
                  </span>
                  <PaymentMarks
                    ids={acceptedPaymentIds({ onlinePayment, paypalPayment })}
                    className="justify-center"
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
