"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  EMPTY_CART,
  cartCount,
  cartTotalCents,
  clearCart,
  formatCents,
  getCartSnapshot,
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

export function CartDrawer({
  slug,
  currency,
  locale,
  modes,
  requestSlots = [],
  onlinePayment,
}: {
  slug: string;
  currency: string;
  locale: string;
  modes: DrawerModes;
  /** Venue-local "HH:MM" times selectable for later today (server-built
   *  from opening hours). Empty = ASAP-only. */
  requestSlots?: string[];
  onlinePayment: boolean;
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
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
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

  return (
    <div className="menu-theme">
      {/* Floating bar */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="menu-pop fixed bottom-4 right-4 z-30 flex items-center gap-3 rounded-full border border-[var(--menu-surface-accent,var(--menu-accent))]/50 bg-[var(--menu-surface)] px-5 py-3 text-sm font-medium text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_18px_36px_-12px_rgba(0,0,0,0.45)] transition-transform hover:scale-[1.03] active:scale-95"
        >
          {placed ? (
            <span className="text-[var(--menu-surface-accent,var(--menu-accent))]">
              Order #{placed.orderNumber} ✓
            </span>
          ) : (
            <>
              <span className="relative inline-flex" aria-hidden="true">
                <CartIcon className="h-5 w-5 text-[var(--menu-surface-accent,var(--menu-accent))]" />
                <span className="absolute -right-2.5 -top-2 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-[var(--menu-accent)] px-1 text-[10px] font-bold leading-none text-[var(--menu-bg)]">
                  {count}
                </span>
              </span>
              <span className="ml-1">Your order</span>
              <span className="font-semibold text-[var(--menu-surface-accent,var(--menu-accent))]">
                {money(total)}
              </span>
            </>
          )}
        </button>
      ) : null}

      {/* Drawer */}
      {open ? (
        <div
          role="dialog"
          aria-label="Your order"
          className="menu-sheet fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[85vh] w-full max-w-lg touch-pan-y overflow-y-auto overscroll-contain rounded-t-2xl supports-[height:100dvh]:max-h-[85dvh] border border-[var(--menu-line)] bg-[var(--menu-surface)] p-5 text-[var(--menu-surface-text,var(--menu-text))] shadow-[0_-24px_48px_-24px_rgba(0,0,0,0.55)] sm:bottom-4 sm:right-4 sm:mx-0 sm:ml-auto sm:rounded-2xl"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2.5 font-serif text-2xl">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--menu-surface-accent,var(--menu-accent))]/40 bg-[var(--menu-accent)]/10"
              >
                <CartIcon className="h-4.5 w-4.5 text-[var(--menu-surface-accent,var(--menu-accent))]" />
              </span>
              {placed ? `Order #${placed.orderNumber}` : "Your order"}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close order panel"
              className="rounded-full border border-[var(--menu-line)] px-3 py-1 text-sm hover:border-[var(--menu-surface-accent,var(--menu-accent))]"
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
                <span className="font-semibold text-[var(--menu-surface-accent,var(--menu-accent))]">
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
                  className="block w-full rounded-full bg-[var(--menu-positive)] px-5 py-3 text-center text-sm font-semibold uppercase tracking-[0.14em] text-[var(--menu-bg)] transition hover:opacity-90 active:scale-[0.985] disabled:opacity-60"
                >
                  {payStarting ? "Opening payment…" : `Pay online · ${money(placed.totalCents)}`}
                </button>
              ) : null}
              <a
                href={trackHref}
                className="block w-full rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-5 py-3 text-center text-sm font-semibold uppercase tracking-[0.14em] text-[var(--menu-surface)] hover:opacity-90"
              >
                Track your order
              </a>
              <a
                href={receiptHref}
                className="block w-full rounded-full bg-[var(--menu-accent)] px-5 py-3 text-center text-sm font-semibold uppercase tracking-[0.14em] text-[var(--menu-bg)] hover:opacity-90"
              >
                Download receipt (PDF)
              </a>
              <button
                type="button"
                onClick={() => {
                  setPlaced(null);
                  setTableNumber("");
                  setOpen(false);
                }}
                className="block w-full rounded-full border border-[var(--menu-line)] px-5 py-3 text-center text-sm uppercase tracking-[0.14em] text-[var(--menu-surface-text-soft,var(--menu-text-soft))] hover:border-[var(--menu-surface-accent,var(--menu-accent))]"
              >
                Start a new order
              </button>
            </div>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-[var(--menu-line)]">
                {lines.map((line) => (
                  <li key={line.itemId} className="flex items-center gap-3 py-3">
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
                        className="h-8 w-8 rounded-full border border-[var(--menu-line)] text-base leading-none transition hover:border-[var(--menu-surface-accent,var(--menu-accent))] active:scale-90"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label={`One more ${line.name}`}
                        onClick={() => setQuantity(slug, line.itemId, line.quantity + 1)}
                        className="h-8 w-8 rounded-full border border-[var(--menu-line)] text-base leading-none transition hover:border-[var(--menu-surface-accent,var(--menu-accent))] active:scale-90"
                      >
                        +
                      </button>
                    </div>
                    <p className="w-20 text-right text-sm font-semibold tabular-nums text-[var(--menu-surface-accent,var(--menu-accent))]">
                      {money(line.priceCents * line.quantity)}
                    </p>
                    {/* Remove the whole line in one tap — quicker than
                        stepping the quantity down to zero. */}
                    <button
                      type="button"
                      aria-label={`Remove ${line.name} from the order`}
                      title="Remove"
                      onClick={() => setQuantity(slug, line.itemId, 0)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--menu-surface-text-soft,var(--menu-text-soft))] transition hover:bg-red-500/10 hover:text-red-400 active:scale-90"
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

              <div className="mt-3 flex items-center justify-between border-t border-[var(--menu-line)] pt-3">
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
                <button
                  type="button"
                  onClick={() => clearCart(slug)}
                  className="flex items-center justify-center gap-2 rounded-full border border-[var(--menu-line)] px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--menu-surface-text-soft,var(--menu-text-soft))] transition hover:border-red-400 hover:text-red-400 active:scale-[0.98]"
                >
                  <TrashIcon className="h-4 w-4" />
                  Clear cart
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-full border border-[var(--menu-line)] px-4 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--menu-surface-text-soft,var(--menu-text-soft))] transition hover:border-[var(--menu-surface-accent,var(--menu-accent))] hover:text-[var(--menu-surface-accent,var(--menu-accent))] active:scale-[0.98]"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add items
                </button>
              </div>

              {enabledTypes.length > 1 ? (
                <div
                  role="radiogroup"
                  aria-label="Order type"
                  className="mt-4 grid grid-cols-3 gap-2"
                >
                  {enabledTypes.map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      role="radio"
                      aria-checked={orderType === t.type}
                      onClick={() => setOrderType(t.type)}
                      className={
                        orderType === t.type
                          ? "rounded-lg border border-[var(--menu-surface-accent,var(--menu-accent))] bg-[var(--menu-accent)]/10 px-2 py-2 text-center text-xs font-semibold text-[var(--menu-surface-accent,var(--menu-accent))] transition"
                          : "rounded-lg border border-[var(--menu-line)] px-2 py-2 text-center text-xs text-[var(--menu-surface-text-soft,var(--menu-text-soft))] transition hover:border-[var(--menu-surface-accent,var(--menu-accent))]/60"
                      }
                    >
                      <span aria-hidden="true" className="block text-base">
                        {t.icon}
                      </span>
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {orderType === "dine_in" ? (
                <label className="mt-3 block text-sm">
                  <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                    Table number (optional)
                  </span>
                  <input
                    type="text"
                    value={tableNumber}
                    maxLength={20}
                    onChange={(e) => setTableNumber(e.target.value)}
                    placeholder="e.g. 12"
                    className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
                  />
                </label>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      Your name
                    </span>
                    <input
                      type="text"
                      value={customerName}
                      maxLength={80}
                      required
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      Phone number
                    </span>
                    <input
                      type="tel"
                      value={customerPhone}
                      maxLength={30}
                      required
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+49 …"
                      className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
                    />
                  </label>
                  {requestSlots.length > 0 ? (
                    <label className="block text-sm sm:col-span-2">
                      <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                        {orderType === "delivery" ? "Delivery time" : "Pickup time"}
                      </span>
                      {/* ASAP is the default; the slots are later-today
                          times inside opening hours (server re-checks). */}
                      <select
                        value={requestedTime}
                        onChange={(e) => setRequestedTime(e.target.value)}
                        className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
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
                    <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      Street and house number
                    </span>
                    <input
                      type="text"
                      value={street}
                      maxLength={120}
                      required
                      onChange={(e) => setStreet(e.target.value)}
                      className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
                    />
                  </label>
                  {modes.deliveryAreas.length > 0 ? (
                    <div className="grid grid-cols-[minmax(0,130px)_1fr] gap-3">
                      <label className="block text-sm">
                        <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                          ZIP
                        </span>
                        {/* The restaurant delivers to a fixed ZIP list, so
                            the guest PICKS their area instead of typing —
                            "do you deliver here?" answers itself. */}
                        <select
                          value={zip}
                          required
                          onChange={(e) => setZip(e.target.value)}
                          className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
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
                        <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                          City / Community / Village
                        </span>
                        {/* Filled automatically from the selected ZIP — the
                            restaurant named this area, the guest never
                            types it. */}
                        <input
                          type="text"
                          value={selectedArea?.locality ?? ""}
                          readOnly
                          tabIndex={-1}
                          placeholder="— select your ZIP —"
                          className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-surface)] px-3 py-2 text-[var(--menu-surface-text-soft,var(--menu-text-soft))] outline-none"
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="block max-w-[150px] text-sm">
                      <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                        ZIP
                      </span>
                      <input
                        type="text"
                        value={zip}
                        maxLength={10}
                        required
                        onChange={(e) => setZip(e.target.value)}
                        className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
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
                    <span className="text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
                      Delivery note (optional)
                    </span>
                    <input
                      type="text"
                      value={note}
                      maxLength={200}
                      placeholder="e.g. ring twice, 3rd floor"
                      onChange={(e) => setNote(e.target.value)}
                      className="mt-1 w-full rounded-md border border-[var(--menu-line)] bg-[var(--menu-bg)] px-3 py-2 text-[var(--menu-text)] outline-none focus:border-[var(--menu-surface-accent,var(--menu-accent))]"
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

              {error ? (
                <p role="alert" className="mt-3 text-sm text-red-400">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                disabled={placing || count === 0 || detailsMissing || belowMinimum}
                onClick={() => void submitOrder()}
                className="mt-4 block w-full rounded-full bg-[var(--menu-accent)] px-5 py-3 text-center text-sm font-semibold uppercase tracking-[0.14em] text-[var(--menu-bg)] hover:opacity-90 disabled:opacity-50"
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
