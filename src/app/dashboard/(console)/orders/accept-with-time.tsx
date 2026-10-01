"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";

const STEP = 5;
const MIN = 5;
const MAX = 180;

/**
 * A new order's accept control (owner, 2026-10-01): the promised time
 * between a red − and a red +, in steps of five minutes, and one button
 * that accepts the order WITH that time. It lives only while the accept
 * window is open; when the countdown reaches zero it hands the card back
 * to the ordinary "prepare" button (`fallback`) — the default time is
 * then what the guest was shown, and it no longer moves.
 *
 * The minutes are local state, posted once with the form: the page
 * auto-refreshes every few seconds, and a server round trip per tap
 * would fight it.
 */
export function AcceptWithTime({
  orderId,
  orderType,
  defaultMinutes,
  boardedAt,
  until,
  secondsLeft,
  timezone,
  action,
  fallback,
}: {
  orderId: string;
  orderType: string;
  defaultMinutes: number;
  /** ISO — where the promise is counted from. */
  boardedAt: string;
  /** ISO — when the accept window closes. */
  until: string;
  /** Seconds left when the server rendered the card. */
  secondsLeft: number;
  timezone: string;
  action: (form: FormData) => void | Promise<void>;
  /** What the card shows once the window has closed. */
  fallback: React.ReactNode;
}): React.ReactElement {
  const [minutes, setMinutes] = useState(defaultMinutes);
  // Starts from the server's own count so the first client render matches
  // the HTML it hydrates; the effect below then follows the real clock.
  const [left, setLeft] = useState(secondsLeft);

  useEffect(() => {
    const tick = (): void =>
      setLeft(Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);

  if (left <= 0) return <>{fallback}</>;

  const at = new Intl.DateTimeFormat("de-DE", { timeStyle: "short", timeZone: timezone }).format(
    new Date(new Date(boardedAt).getTime() + minutes * 60_000),
  );
  const step =
    "flex h-11 w-11 shrink-0 items-center justify-center bg-[#b3261e] text-2xl font-bold leading-none text-white hover:bg-[#8f1e18] disabled:opacity-40";

  return (
    <form action={action} className="mt-3 w-full border border-orange/40 bg-orange/5 p-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="minutes" value={minutes} />
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">
          {orderType === "delivery" ? "Set delivery time" : "Set pickup time"}
        </span>
        <span className="font-semibold tabular-nums text-[#b3261e]" aria-live="off">
          {left} s left
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setMinutes((m) => Math.max(MIN, m - STEP))}
          disabled={minutes <= MIN}
          aria-label="5 minutes less"
          className={step}
        >
          −
        </button>
        <p className="text-center" aria-live="polite">
          <span className="block text-2xl font-semibold tabular-nums">{minutes} min</span>
          <span className="block text-xs text-muted">around {at}</span>
        </p>
        <button
          type="button"
          onClick={() => setMinutes((m) => Math.min(MAX, m + STEP))}
          disabled={minutes >= MAX}
          aria-label="5 minutes more"
          className={step}
        >
          +
        </button>
      </div>
      <SubmitButton
        pendingLabel="Accepting…"
        className="mt-3 w-full bg-orange px-3.5 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-card hover:bg-orange-dark"
      >
        Accept · {minutes} min
      </SubmitButton>
    </form>
  );
}
