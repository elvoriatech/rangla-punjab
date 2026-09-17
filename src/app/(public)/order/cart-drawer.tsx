"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MessagePopup } from "@/components/message-popup";
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

interface PlacedOrder {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  currency: string;
  receiptToken: string;
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

const TYPE_META: {
  type: OrderType;
  icon: string;
  label: string;
  enabled: (m: DrawerModes) => boolean;
}[] = [
  { type: "dine_in", icon: "🍽", label: "Dine-in", enabled: (m) => m.dineIn },
  { type: "takeaway", icon: "🥡", label: "Pickup", enabled: (m) => m.takeaway },
  { type: "delivery", icon: "🛵", label: "Delivery", enabled: (m) => m.delivery },
];

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
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-text,var(--menu-text))]";

/** Round icon-only control. 1.4.11 is satisfied by the glyph (4.62:1 composited
 *  at worst), not by the wash, and 32px clears the 24px target floor of 2.5.8. */
const ICON_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 text-[var(--menu-surface-text,var(--menu-text))] transition hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 active:scale-90 " +
  FOCUS_RING;

/** Secondary pill. */
const QUIET_BTN =
  "flex items-center justify-center gap-2 rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--menu-surface-text,var(--menu-text))] transition hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 active:scale-[0.98] " +
  FOCUS_RING;

/** Destructive pill: neutral at rest, danger wash on hover, danger ICON only —
 *  the label stays ink. Declares its own `hover:bg-*` rather than composing
 *  onto QUIET_BTN because two competing `hover:bg-*` utilities resolve by
 *  Tailwind's sort order, not by their order in the string. */
const DANGER_BTN =
  "flex items-center justify-center gap-2 rounded-full bg-[var(--menu-surface-text,var(--menu-text))]/7 px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--menu-surface-text,var(--menu-text))] transition hover:bg-[var(--menu-danger)]/12 [&_svg]:transition-colors hover:[&_svg]:text-[var(--menu-danger)] active:scale-[0.98] " +
  FOCUS_RING;

/** Per-row remove: no fill at rest, because one of these sits in every row and
 *  they must not compete with the dish names. */
const ROW_DELETE_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--menu-surface-text-soft,var(--menu-text-soft))] transition hover:bg-[var(--menu-danger)]/12 hover:text-[var(--menu-danger)] focus-visible:text-[var(--menu-danger)] active:scale-90 " +
  FOCUS_RING;

/** Order-type chips. `relative`/`overflow-hidden` host the selected indicator
 *  bar and `pb-2.5` reserves its room, so selecting never shifts the label. */
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
  "block w-full rounded-full px-5 py-3 text-center text-sm uppercase tracking-[0.14em] transition ";

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

const CTA_SECONDARY =
  CTA_BASE +
  "bg-[var(--menu-surface-text,var(--menu-text))]/7 font-medium text-[var(--menu-surface-text,var(--menu-text))] hover:bg-[var(--menu-surface-text,var(--menu-text))]/13 active:scale-[0.985] " +
  FOCUS_RING;

/** Tertiary: no fill, no border — the underline identifies it as a control. */
const CTA_LINK =
  "block w-full rounded-full px-5 py-2.5 text-center text-xs uppercase tracking-[0.14em] text-[var(--menu-surface-text-soft,var(--menu-text-soft))] underline decoration-1 underline-offset-4 transition hover:text-[var(--menu-surface-text,var(--menu-text))] " +
  FOCUS_RING;

export function CartDrawer({
  slug,
  currency,
  locale,
  modes,
  requestSlots = [],
  onlinePayment,
  paypalPayment = false,
}: {
  slug: string;
  currency: string;
  locale: string;
  modes: DrawerModes;
  /** Venue-local "HH:MM" times selectable for later today (server-built
   *  from opening hours). Empty = ASAP-only. */
  requestSlots?: string[];
  onlinePayment: boolean;
  paypalPayment?: boolean;
}): React.ReactElement | null {
  const lines = useSyncExternalStore(
    subscribeToCart,
    () => getCartSnapshot(slug),
    () => EMPTY_CART,
  );
  const [open, setOpen] = useState(false);

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

  if (count === 0 && !placed) return null;

  async function submitOrder(): Promise<void> {
    setPlacing(true);
    setError(null);
    try {
      const payload = {
        slug,
        orderType,
        requestedTime: orderType !== "dine_in" && requestedTime ? requestedTime : undefined,
        tableNumber: orderType === "dine_in" ? tableNumber.trim() || undefined : undefined,
        customerName: orderType === "dine_in" ? undefined : customerName.trim(),
        customerPhone: orderType === "dine_in" ? undefined : customerPhone.trim(),
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
            ? "The menu changed while you were ordering. Please review your items and try again."
            : body?.error === "rate_limited"
              ? "Too many orders from this connection — please wait a minute."
              : body?.error === "type_not_available"
                ? "This order type just went offline — pick another option."
                : body?.error === "outside_delivery_area"
                  ? "Sorry, that address is outside the delivery area."
                  : body?.error === "below_delivery_minimum"
                    ? `Delivery starts at ${money(areaMin)} — add a little more.`
                    : body?.error === "invalid_time"
                      ? "That time just passed or is outside opening hours — pick another."
                      : "The order didn't go through. Please try again.",
        );
        return;
      }
      const value = (await res.json()) as PlacedOrder;
      // Landed — retire the key so the guest's next basket is a new order.
      attemptRef.current = null;
      setPlaced(value);
      clearCart(slug);
      setOpen(true);
    } catch {
      setError("No connection — check your network and try again.");
    } finally {
      setPlacing(false);
    }
  }

  const receiptHref = placed
    ? `/api/orders/${placed.orderId}/receipt?token=${encodeURIComponent(placed.receiptToken)}&locale=${locale.startsWith("de") ? "de" : "en"}`
    : "#";
  const trackHref = placed
    ? `/order-status/${placed.orderId}?token=${encodeURIComponent(placed.receiptToken)}`
    : "#";
  /** Whether the confirmation screen already has a dominant pay CTA. When it
   *  doesn't, "Track your order" is the primary action and takes that weight. */
  const hasPaymentCta = onlinePayment || paypalPayment;

  return (
    <div className="menu-theme">
      {/* Floating bar */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            "menu-pop fixed bottom-4 right-4 z-30 flex items-center gap-3 rounded-full bg-[var(--menu-surface)] px-5 py-3 text-sm font-medium text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_18px_36px_-12px_rgba(0,0,0,0.45)] transition-transform hover:scale-[1.03] active:scale-95 " +
            FOCUS_RING
          }
        >
          {placed ? (
            <span className="text-[var(--menu-surface-accent,var(--menu-accent))]">
              Order #{placed.orderNumber} ✓
            </span>
          ) : (
            <>
              <span className="relative inline-flex" aria-hidden="true">
                <CartIcon className="h-5 w-5 text-[var(--menu-surface-accent,var(--menu-accent))]" />
                <span className="absolute -right-2.5 -top-2 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-[var(--menu-accent)] px-1 text-[10px] font-bold leading-none text-[var(--menu-on-accent,var(--menu-bg))]">
                  {count}
                </span>
              </span>
              <span className="ml-1">Your order</span>
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
          aria-label="Your order"
          /* The ONE surviving four-sided border, re-based from `--menu-line` to
             ink/10: a dark sheet on a dark ground needs an edge and the shadow
             alone will not carry it, but it must be the same faint step off the
             surface on every theme rather than a gold rule on one. */
          className="menu-sheet fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[85vh] w-full max-w-lg touch-pan-y overflow-y-auto overscroll-contain rounded-t-2xl supports-[height:100dvh]:max-h-[85dvh] border border-[var(--menu-surface-text,var(--menu-text))]/10 bg-[var(--menu-surface)] p-5 text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_-24px_48px_-24px_rgba(0,0,0,0.55)] sm:bottom-4 sm:right-4 sm:mx-0 sm:ml-auto sm:rounded-2xl"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2.5 font-serif text-2xl">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))]/14"
              >
                <CartIcon className="h-4.5 w-4.5 text-[var(--menu-surface-accent,var(--menu-accent))]" />
              </span>
              {placed ? `Order #${placed.orderNumber}` : "Your order"}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close order panel"
              className={ICON_BTN}
            >
              ✕
            </button>
          </div>

          {placed ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                Your order is in — the staff sees it as{" "}
                <span className="font-semibold text-[var(--menu-surface-text,var(--menu-text))]">
                  order #{placed.orderNumber}
                </span>
                {tableNumber.trim() ? ` for table ${tableNumber.trim()}` : ""}. Total{" "}
                {/* Ink, not accent: 14px semibold, same 3.28:1 reason. */}
                <span className="font-semibold text-[var(--menu-surface-text,var(--menu-text))]">
                  {money(placed.totalCents)}
                </span>
                , payable at the restaurant.
              </p>
              {onlinePayment && placed ? (
                <button
                  type="button"
                  disabled={payStarting}
                  onClick={async () => {
                    setPayStarting(true);
                    try {
                      const res = await fetch(`/api/orders/${placed.orderId}/pay`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ token: placed.receiptToken }),
                      });
                      const body = (await res.json()) as { url?: string };
                      if (res.ok && body.url) {
                        location.href = body.url;
                        return;
                      }
                      setPayStarting(false);
                    } catch {
                      setPayStarting(false);
                    }
                  }}
                  className={CTA_PAY}
                >
                  {payStarting ? "Opening payment…" : `Pay online · ${money(placed.totalCents)}`}
                </button>
              ) : null}
              {paypalPayment && placed ? (
                <button
                  type="button"
                  disabled={payStarting}
                  onClick={async () => {
                    setPayStarting(true);
                    try {
                      const res = await fetch(`/api/orders/${placed.orderId}/pay/paypal`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ token: placed.receiptToken }),
                      });
                      const body = (await res.json()) as { url?: string };
                      if (res.ok && body.url) {
                        location.href = body.url;
                        return;
                      }
                      setPayStarting(false);
                    } catch {
                      setPayStarting(false);
                    }
                  }}
                  /* DELIBERATE EXCEPTION to everything above: PayPal's brand
                     guidelines mandate this yellow/navy button, so it is the
                     only hard-coded hex in the file and the only four-sided
                     border besides the sheet's own edge. Do not "theme" it. */
                  className={
                    "block w-full rounded-full border-2 border-[#003087] bg-[#ffc439] px-5 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-[#003087] transition hover:opacity-90 active:scale-[0.985] disabled:opacity-60 " +
                    FOCUS_RING
                  }
                >
                  {payStarting ? "Opening PayPal…" : "Mit PayPal zahlen"}
                </button>
              ) : null}
              {/* One dominant fill, then a wash, then text links. This stack
                  used to be four solid fills plus an outline, so nothing led
                  and the PDF download shouted as loudly as paying. Track is
                  promoted to primary only when there is nothing left to pay. */}
              <a href={trackHref} className={hasPaymentCta ? CTA_SECONDARY : CTA_PRIMARY}>
                Track your order
              </a>
              <a href={receiptHref} className={CTA_LINK}>
                Download receipt (PDF)
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
                Start a new order
              </button>
            </div>
          ) : (
            <>
              {/* No dividers. Rows are separated by proximity instead: the
                  inter-row gap (16px) is more than twice the largest gap inside
                  a row, the tinted qty cluster anchors each one, and the price
                  is right-aligned. A faint hairline was the alternative and it
                  composites to ~1.15:1 — the same mush this replaced, and the
                  first thing to disappear on a phone in daylight. */}
              <ul className="mt-4 space-y-4">
                {lines.map((line) => (
                  <li key={line.itemId} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                        {money(line.priceCents)} each
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`One less ${line.name}`}
                        onClick={() => setQuantity(slug, line.itemId, line.quantity - 1)}
                        className={ICON_BTN + " text-base leading-none"}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label={`One more ${line.name}`}
                        onClick={() => setQuantity(slug, line.itemId, line.quantity + 1)}
                        className={ICON_BTN + " text-base leading-none"}
                      >
                        +
                      </button>
                    </div>
                    {/* Ink, not accent — 14px semibold accent is 3.28:1 on
                        fresh-bistro, and reserving gold for the TOTAL alone
                        makes the total read as the summary it is. */}
                    <p className="w-20 text-right text-sm font-semibold tabular-nums">
                      {money(line.priceCents * line.quantity)}
                    </p>
                    {/* Remove the whole line in one tap — quicker than
                        stepping the quantity down to zero. */}
                    <button
                      type="button"
                      aria-label={`Remove ${line.name} from the order`}
                      title="Remove"
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
                <span className="text-sm uppercase tracking-[0.18em] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  Total
                </span>
                <span className="font-serif text-2xl font-semibold text-[var(--menu-surface-accent,var(--menu-accent))]">
                  {money(total)}
                </span>
              </div>

              {/* Cart actions: empty the whole order, or hop back to the
                  menu to add more — both icon + label, no-JS-safe. */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => clearCart(slug)} className={DANGER_BTN}>
                  <TrashIcon className="h-4 w-4" />
                  Clear cart
                </button>
                <button type="button" onClick={() => setOpen(false)} className={QUIET_BTN}>
                  <PlusIcon className="h-4 w-4" />
                  Add items
                </button>
              </div>

              {enabledTypes.length > 1 ? (
                <div
                  role="radiogroup"
                  aria-label="Order type"
                  /* Was a hardcoded grid-cols-3, so two enabled modes rendered
                     at a third of the width beside a dead column. Both literals
                     must appear in source for Tailwind to emit them. */
                  className={
                    enabledTypes.length === 2
                      ? "mt-4 grid grid-cols-2 gap-2"
                      : "mt-4 grid grid-cols-3 gap-2"
                  }
                >
                  {enabledTypes.map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      role="radio"
                      aria-checked={orderType === t.type}
                      onClick={() => setOrderType(t.type)}
                      className={orderType === t.type ? CHIP_ON : CHIP_IDLE}
                    >
                      <span aria-hidden="true" className="block text-base">
                        {t.icon}
                      </span>
                      {t.label}
                      {/* Selection needs three simultaneous signals, because the
                          wash alone is 1.17:1 against the surface and 1.4.1
                          forbids color as the only carrier: hue (accent wash vs
                          neutral), weight (semibold), and this solid bar, which
                          carries the ≥3:1 state contrast as a FILL rather than a
                          border. Reads as a segmented control. */}
                      {orderType === t.type ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--menu-surface-accent,var(--menu-accent))]"
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {orderType === "dine_in" ? (
                <label className="mt-3 block text-sm">
                  <span className={FIELD_LABEL}>Table number (optional)</span>
                  <input
                    type="text"
                    value={tableNumber}
                    maxLength={20}
                    onChange={(e) => setTableNumber(e.target.value)}
                    placeholder="e.g. 12"
                    className={FIELD}
                  />
                </label>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className={FIELD_LABEL}>Your name</span>
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
                    <span className={FIELD_LABEL}>Phone number</span>
                    <input
                      type="tel"
                      value={customerPhone}
                      maxLength={30}
                      required
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+49 …"
                      className={FIELD}
                    />
                  </label>
                  {requestSlots.length > 0 ? (
                    <label className="block text-sm sm:col-span-2">
                      <span className={FIELD_LABEL}>
                        {orderType === "delivery" ? "Delivery time" : "Pickup time"}
                      </span>
                      {/* ASAP is the default; the slots are later-today
                          times inside opening hours (server re-checks). */}
                      <select
                        value={requestedTime}
                        onChange={(e) => setRequestedTime(e.target.value)}
                        className={FIELD_SELECT}
                      >
                        <option value="">As soon as possible</option>
                        {requestSlots.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              )}

              {orderType === "delivery" ? (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm">
                    <span className={FIELD_LABEL}>Street and house number</span>
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
                        <span className={FIELD_LABEL}>ZIP</span>
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
                            Select…
                          </option>
                          {modes.deliveryAreas.map((a) => (
                            <option key={a.zip} value={a.zip}>
                              {a.zip}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        <span className={FIELD_LABEL}>City / Community / Village</span>
                        {/* Filled automatically from the selected ZIP — the
                            restaurant named this area, the guest never
                            types it. */}
                        <input
                          type="text"
                          value={selectedArea?.locality ?? ""}
                          readOnly
                          tabIndex={-1}
                          placeholder="— select your ZIP —"
                          className={FIELD_READONLY}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="block max-w-[150px] text-sm">
                      <span className={FIELD_LABEL}>ZIP</span>
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
                  {selectedArea && selectedArea.freeOverCents > 0 ? (
                    <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      {itemsTotal >= selectedArea.freeOverCents
                        ? "Free delivery to this area 🎉"
                        : `Free delivery from ${money(selectedArea.freeOverCents)}`}
                    </p>
                  ) : null}
                  <label className="block text-sm">
                    <span className={FIELD_LABEL}>Delivery note (optional)</span>
                    <input
                      type="text"
                      value={note}
                      maxLength={200}
                      placeholder="e.g. ring twice, 3rd floor"
                      onChange={(e) => setNote(e.target.value)}
                      className={FIELD}
                    />
                  </label>
                  {feeCents > 0 ? (
                    <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      Delivery fee {money(feeCents)}
                      {areaMin > 0 ? ` · minimum order ${money(areaMin)}` : ""}
                    </p>
                  ) : areaMin > 0 ? (
                    <p className="text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      Minimum order {money(areaMin)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {error ? <MessagePopup kind="error" text={error} /> : null}

              <button
                type="button"
                disabled={placing || count === 0 || detailsMissing || belowMinimum}
                onClick={() => void submitOrder()}
                className={"mt-4 " + CTA_PRIMARY}
              >
                {placing ? "Placing…" : `Place order · ${money(total)}`}
              </button>
              {belowMinimum ? (
                <p className="mt-2 text-center text-[11px] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  Delivery starts at {money(areaMin)} — add {money(areaMin - itemsTotal)} more.
                </p>
              ) : (
                <p className="mt-2 text-center text-[11px] text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                  {orderType === "delivery"
                    ? "No payment online — you pay the driver."
                    : orderType === "takeaway"
                      ? "No payment online — you pay at pickup."
                      : "No payment now — you pay at the restaurant."}
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
