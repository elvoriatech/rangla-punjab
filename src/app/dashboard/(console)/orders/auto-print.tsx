"use client";

import { useEffect, useSyncExternalStore } from "react";

const PREF_KEY = "rangla-auto-print";
const MAX_KEY = "rangla-auto-print-max";
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
  open: { id: string; orderNumber: number }[];
  printBase: string;
}): React.ReactElement {
  const pref = useSyncExternalStore(subscribe, readPref, () => "on");
  const enabled = pref === "on";

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const incomingMax = open.reduce((max, o) => Math.max(max, o.orderNumber), 0);
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(MAX_KEY);
    } catch {
      return;
    }
    if (stored === null) {
      // First run on this device: don't reprint the whole history.
      window.localStorage.setItem(MAX_KEY, String(incomingMax));
      return;
    }
    const lastPrinted = Number(stored) || 0;
    const fresh = open.filter((o) => o.orderNumber > lastPrinted);
    if (fresh.length === 0) return;
    window.localStorage.setItem(MAX_KEY, String(Math.max(incomingMax, lastPrinted)));

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
