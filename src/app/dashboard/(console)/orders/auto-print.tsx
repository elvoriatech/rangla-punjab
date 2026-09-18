"use client";

import { useEffect, useSyncExternalStore } from "react";

const PREF_KEY = "rangla-auto-print";
/** Legacy: highest order number printed. Read once to baseline, then retired. */
const MAX_KEY = "rangla-auto-print-max";
/** Order ids already printed on this device (most recent last, capped). */
const PRINTED_KEY = "rangla-auto-print-ids";
const PRINTED_CAP = 500;

export interface PrintableOrder {
  id: string;
  orderNumber: number;
  /** none = cash, pending = online payment started, paid = settled. */
  paymentStatus: string;
}

/**
 * A ticket goes to the kitchen when the restaurant is sure of the money:
 * cash orders at once; card / PayPal orders only once the payment has
 * settled (a pending one may be abandoned in the checkout, and a kitchen
 * that already cooked it has no recourse). Pure, so it is unit-tested.
 */
export function isReadyToPrint(order: PrintableOrder): boolean {
  return order.paymentStatus !== "pending";
}

/** Which of the open orders still need a ticket on this device. */
export function pickOrdersToPrint(
  open: PrintableOrder[],
  printedIds: ReadonlySet<string>,
): PrintableOrder[] {
  return open.filter((o) => isReadyToPrint(o) && !printedIds.has(o.id));
}

function readPrinted(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PRINTED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writePrinted(ids: Set<string>): void {
  const arr = [...ids].slice(-PRINTED_CAP);
  window.localStorage.setItem(PRINTED_KEY, JSON.stringify(arr));
}
const PREF_EVENT = "rangla-auto-print-pref";

function subscribe(callback: () => void): () => void {
  window.addEventListener(PREF_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PREF_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function readPref(): string {
  try {
    return window.localStorage.getItem(PREF_KEY) ?? "on";
  } catch {
    return "on";
  }
}

/**
 * Prints every NEW order automatically: the Orders page re-polls, this
 * watcher compares incoming order numbers against the highest one it has
 * already printed (persisted, so a page reload doesn't reprint history)
 * and loads the ticket with ?auto=1 in a hidden iframe — the ticket
 * fires the print dialog itself. On first ever run it baselines to the
 * current max instead of printing the backlog. With the receipt printer
 * as OS default and Chrome's kiosk-printing mode, this prints silently.
 */
export function AutoPrint({
  open,
  printBase,
}: {
  open: PrintableOrder[];
  printBase: string;
}): React.ReactElement {
  const pref = useSyncExternalStore(subscribe, readPref, () => "on");
  const enabled = pref === "on";

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let printed: Set<string>;
    let hasIds: boolean;
    let legacyMax: string | null;
    try {
      hasIds = window.localStorage.getItem(PRINTED_KEY) !== null;
      legacyMax = window.localStorage.getItem(MAX_KEY);
      printed = readPrinted();
    } catch {
      return;
    }
    if (!hasIds) {
      // First run on this device (or first run since the id-based tracker
      // replaced the order-number high-water mark): baseline to what is on
      // screen instead of reprinting the whole backlog. Pending online
      // orders are deliberately NOT baselined — they print when paid.
      for (const o of open) if (isReadyToPrint(o)) printed.add(o.id);
      // Legacy high-water mark: anything at or below it was already printed.
      if (legacyMax !== null) {
        const max = Number(legacyMax) || 0;
        for (const o of open) if (o.orderNumber <= max) printed.add(o.id);
        window.localStorage.removeItem(MAX_KEY);
      }
      writePrinted(printed);
      return;
    }
    const fresh = pickOrdersToPrint(open, printed);
    if (fresh.length === 0) return;
    for (const o of fresh) printed.add(o.id);
    writePrinted(printed);

    for (const order of fresh) {
      const frame = document.createElement("iframe");
      frame.src = `${printBase}/${order.id}?auto=1`;
      frame.setAttribute("aria-hidden", "true");
      frame.style.position = "fixed";
      frame.style.width = "0";
      frame.style.height = "0";
      frame.style.border = "0";
      document.body.appendChild(frame);
      // Long enough for the dialog; the frame is invisible either way.
      setTimeout(() => frame.remove(), 30_000);
    }
  }, [open, enabled, printBase]);

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        checked={enabled}
        onChange={() => {
          try {
            window.localStorage.setItem(PREF_KEY, enabled ? "off" : "on");
          } catch {
            // Storage blocked — the toggle just won't persist.
          }
          window.dispatchEvent(new Event(PREF_EVENT));
        }}
        className="accent-orange"
      />
      <span>🖨 Auto-print new orders</span>
    </label>
  );
}
