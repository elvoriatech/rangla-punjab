"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

/**
 * First-visit privacy notice for the public menu.
 *
 * This is deliberately NOT a cookie banner. The public menu sets no
 * cookie, loads no third-party script and measures nothing, so there is
 * no consent to collect and no "Reject" to offer — the only honest
 * control is an acknowledgement. What it does is TELL the guest that,
 * and point at the policy.
 *
 * Storage follows the same rule the basket already does
 * (`order/cart-store.ts`): one strictly-necessary `localStorage` key, on
 * the guest's own device, never read by the server.
 *
 * Why the acknowledgement is read through `useSyncExternalStore` with an
 * "already acknowledged" SERVER snapshot:
 *
 *  - the menu page is static and edge-cached, so the server cannot know
 *    whether this guest has acknowledged — rendering the notice into the
 *    HTML would show it to everyone, forever, on every cached page;
 *  - the server snapshot and the first client render agree, so there is
 *    no hydration mismatch;
 *  - with JavaScript off nothing renders at all, which is correct: a
 *    guest who cannot run JS also cannot fill the basket, so there is no
 *    device storage to disclose.
 *
 * A `localStorage` that throws (private mode, blocked site data) is
 * treated as "not acknowledged": the guest sees the notice, and pressing
 * "Got it" dismisses it for the session even if the write fails.
 */

/**
 * The four strings the panel shows. A plain string bag, NOT `MenuCopy`:
 * `MenuView` is a Server Component and the catalogue carries functions
 * (`rating.summary`, `items.spicyTitle`, …), which cannot cross the
 * server→client boundary. Same shape of contract as `ReserveLabels` and
 * `AllergenLabels` next door — the server hands over `t.privacy`, which
 * is already all strings.
 */
export interface PrivacyLabels {
  title: string;
  body: string;
  link: string;
  ok: string;
}

/** One key, versioned so re-worded copy can ask again if it ever must. */
export const PRIVACY_ACK_KEY = "rp.privacy.ack.v1";

/** Fired by "Got it" so the store re-reads without waiting for a
 *  cross-tab `storage` event (which never fires in the tab that wrote). */
const ACK_EVENT = "rangla-privacy-ack";

/**
 * Dismissal that survives a `localStorage` the browser refuses to write
 * (private mode, blocked site data). Module-level so the notice stays
 * gone for the rest of the visit rather than returning on the next
 * re-render of a page that could not persist the answer.
 */
let dismissedThisSession = false;

function subscribe(callback: () => void): () => void {
  window.addEventListener(ACK_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(ACK_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Stable primitive snapshots — `useSyncExternalStore` compares by
 *  identity and would loop on a fresh object every read. */
function readAck(): "ack" | "new" {
  if (dismissedThisSession) return "ack";
  try {
    return window.localStorage.getItem(PRIVACY_ACK_KEY) ? "ack" : "new";
  } catch {
    // No readable storage — we cannot prove they have seen it, so show it.
    return "new";
  }
}

/**
 * The cart drawer's focus ring, verbatim. Copied rather than imported:
 * the drawer is a heavy client chunk and this notice must not pull it
 * onto the critical path.
 */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-text,var(--menu-text))]";

export function PrivacyNotice({ labels }: { labels: PrivacyLabels }): React.ReactElement | null {
  const state = useSyncExternalStore(subscribe, readAck, () => "ack" as const);

  if (state === "ack") return null;

  const dismiss = (): void => {
    dismissedThisSession = true;
    try {
      window.localStorage.setItem(PRIVACY_ACK_KEY, "1");
    } catch {
      // Storage refused the write; `dismissedThisSession` still closes it
      // for this visit. Re-asking next time is the harmless direction.
    }
    window.dispatchEvent(new Event(ACK_EVENT));
  };

  return (
    <section
      role="region"
      aria-label={labels.title}
      /*
       * Stacking, decided against the cart drawer's own fixed layers
       * (`order/cart-drawer.tsx`): the floating basket bar is `z-30` and
       * the open checkout sheet is `z-40`.
       *
       *  - `z-[35]` puts the notice ABOVE the floating basket bar — it can
       *    never be buried by it — while staying BELOW the checkout sheet,
       *    so it does not float over a guest filling in their address. It
       *    returns as soon as the sheet closes.
       *  - the 5rem bottom offset (plus the safe-area inset) clears the
       *    basket bar's own `bottom-4` + ~2.75rem height outright, so the
       *    notice never covers the "your order" button even where the two
       *    overlap horizontally on a narrow screen.
       *
       * `fade-in-up` is the page's own entrance: translate only, never
       * opacity — see the note by `ANIMATION_CSS` in menu-view.tsx — and
       * it is already switched off under `prefers-reduced-motion`.
       */
      className="fade-in-up fixed inset-x-0 z-[35] mx-4 rounded-2xl bg-[var(--menu-surface)] p-4 text-[var(--menu-surface-text,var(--menu-text))] shadow-2xl ring-1 ring-[var(--menu-surface-text,var(--menu-text))]/15 sm:mx-auto sm:max-w-md"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
    >
      <p className="text-sm font-semibold">{labels.title}</p>
      <p className="mt-1 text-sm leading-snug text-[var(--menu-surface-text-soft,var(--menu-text-soft))]">
        {labels.body}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {/* 44px tall via the padding, not a fixed height, so the label
            still wraps rather than being clipped in a long locale. */}
        <Link
          href="/legal/privacy"
          className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm underline decoration-[var(--menu-surface-accent,var(--menu-accent))] decoration-1 underline-offset-4 hover:decoration-2 ${FOCUS_RING}`}
        >
          {labels.link}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))] px-5 text-sm font-semibold text-[var(--menu-on-surface-accent,var(--menu-bg))] transition hover:opacity-90 active:scale-[0.985] sm:flex-none ${FOCUS_RING}`}
        >
          {labels.ok}
        </button>
      </div>
    </section>
  );
}
