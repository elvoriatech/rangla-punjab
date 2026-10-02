"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SubmitButton } from "@/components/submit-button";

const CHOICES = [
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "day", label: "Rest of the day", hint: "until your next opening time" },
] as const;

/**
 * "Taking orders" — the restaurant's open/closed switch (owner,
 * 2026-10-02). Switching it OFF asks for how long (30 minutes, an hour,
 * the rest of the day); ordering reopens by itself when that runs out,
 * and switching it back ON reopens at once.
 *
 * The switch is a real form, so it works with JavaScript off for
 * reopening; closing needs the dialog to pick the duration.
 */
export function OrderingSwitch({
  pausedUntil,
  untilLabel,
  canChange,
  action,
}: {
  /** ISO — ordering is closed until then; null = taking orders. */
  pausedUntil: string | null;
  /** That instant, formatted on the server in the venue's timezone. */
  untilLabel: string | null;
  canChange: boolean;
  action: (form: FormData) => void | Promise<void>;
}): React.ReactElement {
  const [dialog, setDialog] = useState(false);
  const [choice, setChoice] = useState<string>("60");
  // Flips the card back to "open" when the pause runs out while the page
  // is on screen, without waiting for a reload.
  // Holds the pause that ran out, so a NEW pause is not mistaken for it.
  const [expiredPause, setExpiredPause] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const closed = pausedUntil !== null && expiredPause !== pausedUntil;

  useEffect(() => {
    if (!pausedUntil) return;
    const ms = new Date(pausedUntil).getTime() - Date.now();
    const timer = setTimeout(() => setExpiredPause(pausedUntil), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [pausedUntil]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setDialog(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog]);

  return (
    <section
      aria-label="Taking orders"
      className={`mt-8 flex flex-wrap items-center justify-between gap-4 border-2 bg-card px-5 py-4 ${
        closed ? "border-[#b3261e]" : "border-[#3f7030]"
      }`}
    >
      <div>
        <p className="font-serif text-xl leading-tight">
          {closed ? "Closed — not taking orders" : "Open — taking orders"}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {closed
            ? `Guests can browse the menu but cannot order. Reopens ${untilLabel ?? "soon"}.`
            : "Guests can order within your opening hours."}
        </p>
      </div>
      {canChange ? (
        <form ref={formRef} action={action}>
          <input type="hidden" name="pause" value={closed ? "off" : choice} />
          {closed ? (
            <SubmitButton
              pendingLabel="Opening…"
              className="bg-[#3f7030] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-white hover:bg-[#33592a]"
            >
              Open now
            </SubmitButton>
          ) : (
            <button
              type="button"
              onClick={() => setDialog(true)}
              className="border border-[#b3261e] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#b3261e] hover:bg-[#b3261e] hover:text-white"
            >
              Stop taking orders
            </button>
          )}
        </form>
      ) : null}
      {dialog && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Stop taking orders"
            >
              <div
                aria-hidden="true"
                onClick={() => setDialog(false)}
                className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              />
              <div className="relative w-full max-w-sm border border-ink/15 bg-card p-6 text-ink shadow-[0_32px_80px_-24px_rgba(0,0,0,0.6)]">
                <p className="font-serif text-xl leading-snug">Stop taking orders</p>
                <p className="mt-1 text-sm text-muted">
                  For how long? Ordering switches back on by itself.
                </p>
                <fieldset className="mt-4 space-y-2">
                  <legend className="sr-only">Duration</legend>
                  {CHOICES.map((c) => (
                    <label
                      key={c.value}
                      className={`flex cursor-pointer items-center gap-3 border px-3 py-2.5 text-sm ${
                        choice === c.value ? "border-[#b3261e] bg-[#b3261e]/5" : "border-ink/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="pause-choice"
                        value={c.value}
                        checked={choice === c.value}
                        onChange={() => setChoice(c.value)}
                        className="accent-[#b3261e]"
                      />
                      <span>
                        <span className="font-medium">{c.label}</span>
                        {"hint" in c ? (
                          <span className="block text-xs text-muted">{c.hint}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setDialog(false)}
                    className="border border-ink/25 px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink hover:border-ink/60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDialog(false);
                      formRef.current?.requestSubmit();
                    }}
                    className="border border-[#b3261e] bg-[#b3261e] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white hover:bg-[#8f1e18]"
                  >
                    Close now
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
