"use client";

import { useState } from "react";

export interface ServedOrderView {
  id: string;
  number: string;
  table: string | null;
  time: string;
  summary: string;
}

/**
 * "Served today" lives behind a small burger button in the corner —
 * closed by default so the board stays tickets-only. Clicking the button
 * (or ✕, or the backdrop) toggles a narrow right-side drawer of calm
 * green cards.
 */
export function ServedDrawer({ orders }: { orders: ServedOrderView[] }): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Corner burger */}
      <button
        type="button"
        aria-label={open ? "Close served orders" : `Show served orders (${orders.length} today)`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 flex-col items-center justify-center gap-[5px] rounded-full border border-emerald-400/50 bg-[#1a1510] shadow-[0_12px_24px_-8px_rgba(0,0,0,0.7)] transition-colors hover:border-emerald-300"
      >
        <span aria-hidden="true" className="block h-[2px] w-5 rounded bg-emerald-300" />
        <span aria-hidden="true" className="block h-[2px] w-5 rounded bg-emerald-300" />
        <span aria-hidden="true" className="block h-[2px] w-5 rounded bg-emerald-300" />
        {orders.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-[#14100c]">
            {orders.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Backdrop — tap anywhere off the drawer to close */}
          <button
            type="button"
            aria-label="Close served orders"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-black/40"
          />
          <aside
            role="dialog"
            aria-label="Served today"
            className="fixed inset-y-0 right-0 z-40 flex w-72 flex-col border-l border-emerald-500/30 bg-[#171310] shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.8)] sm:w-80"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-emerald-300/90">
                <span aria-hidden="true">✓</span> Served today ({orders.length})
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full border border-white/15 px-2.5 py-1 text-sm text-white/60 hover:border-white/40 hover:text-white"
              >
                ✕
              </button>
            </div>
            <ul className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
              {orders.length === 0 ? (
                <li className="pt-8 text-center text-sm text-white/40">
                  Nothing served yet today.
                </li>
              ) : (
                orders.map((order) => (
                  <li
                    key={order.id}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.07] px-3.5 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-serif text-lg tabular-nums text-emerald-100">
                        {order.number}
                        {order.table ? (
                          <span className="ml-2 text-xs text-emerald-300/90">
                            Table {order.table}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] tabular-nums text-emerald-200/60">{order.time}</p>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-emerald-100/70">{order.summary}</p>
                  </li>
                ))
              )}
            </ul>
          </aside>
        </>
      ) : null}
    </>
  );
}
