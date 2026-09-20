"use client";

import { useState, useSyncExternalStore } from "react";
import { readLastOrder, subscribeLastOrders } from "./order/last-order-store";

/**
 * "Complaint", beside the Reserve button.
 *
 * The app has had this on its home screen for a while; the website did
 * not, because a complaint belongs to an ORDER and the website keeps no
 * order history. It does now, in the narrow sense that matters:
 * `order/last-order-store.ts` remembers the tracking id and receipt token
 * of the last few orders this browser placed, so the button can hand the
 * guest straight to the complaint form on their own order.
 *
 * With nothing stored it explains where a complaint is raised rather than
 * dead-ending. That is also what the SERVER renders — a static, edge-
 * cached menu page cannot know what is in this browser's localStorage,
 * and rendering the link into the HTML would give every guest someone
 * else's order. The `useSyncExternalStore` server snapshot is therefore
 * "no order", which is exactly what the first client render sees too, so
 * there is no hydration mismatch; the link appears a tick later if the
 * store has something.
 *
 * With JavaScript off the button renders and does nothing, like the
 * Reserve button next to it — no ordering path depends on either.
 */

/** Plain strings, handed down by the Server Component that renders the
 *  menu — `MenuCopy` carries functions and cannot cross that boundary.
 *  Same contract as `ReserveLabels` and `PrivacyLabels`. */
export interface ComplaintLabels {
  button: string;
  title: string;
  body: string;
  close: string;
}

/** Stable primitive snapshot: `useSyncExternalStore` compares by identity,
 *  so returning a fresh object every read would loop. The href IS the
 *  state — there is nothing else about the order this button needs. */
function complaintHref(slug: string): string {
  const order = readLastOrder(slug);
  if (!order) return "";
  // `#issue` is the anchor `issue-section.tsx` puts on the complaint
  // panel, and `token` is how the tracker authorizes the read — the
  // receipt link the guest was emailed carries the same pair.
  return `/order-status/${encodeURIComponent(order.orderId)}?token=${encodeURIComponent(
    order.receiptToken,
  )}#issue`;
}

/** The Reserve button's pill, minus the accent fill: this is the quieter
 *  of the two, and two solid accent pills side by side read as one
 *  control split in half. */
const PILL =
  "z-10 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-current/30 bg-black/25 py-1.5 ps-2.5 pe-3 text-xs font-semibold shadow-sm backdrop-blur-sm hover:bg-black/35";

function ChatGlyph(): React.ReactElement {
  return (
    // Inline, like the reserve dialog's calendar: the guest bundle carries
    // no icon library and is not about to start for one speech bubble.
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-4.9A8.4 8.4 0 0 1 4.2 11a8.4 8.4 0 0 1 8.4-8.4h.5a8.4 8.4 0 0 1 7.9 7.9Z" />
    </svg>
  );
}

export function ComplaintLink({
  slug,
  labels,
  onDark = false,
}: {
  slug: string;
  labels: ComplaintLabels;
  /** On the hero's photo scrim the pill needs white ink; in the sticky bar
   *  it inherits the menu theme's own. Mirrors `RatingLine`'s prop. */
  onDark?: boolean;
}): React.ReactElement {
  const href = useSyncExternalStore(
    subscribeLastOrders,
    () => complaintHref(slug),
    () => "",
  );
  const [open, setOpen] = useState(false);
  const tone = onDark ? "text-white" : "text-[var(--menu-text)]";

  if (href) {
    return (
      <a href={href} className={`${PILL} ${tone}`}>
        <ChatGlyph />
        {labels.button}
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${PILL} ${tone}`}>
        <ChatGlyph />
        {labels.button}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="complaint-title"
            className="w-full max-w-md rounded-t-2xl bg-[var(--menu-surface,var(--menu-bg))] p-6 text-start text-[var(--menu-surface-text,var(--menu-text))] shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="complaint-title" className="font-serif text-xl">
                {labels.title}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={labels.close}
                className="rounded p-1 text-2xl leading-none text-[var(--menu-surface-text-soft,var(--menu-text-soft))] hover:text-[var(--menu-surface-text,var(--menu-text))]"
              >
                ×
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
              {labels.body}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-6 w-full rounded-full bg-[var(--menu-accent)] py-2.5 text-sm font-semibold text-[var(--menu-on-accent,#fff)] hover:opacity-90"
            >
              {labels.close}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
