"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SubmitButton } from "./submit-button";

/**
 * A submit button that asks first — in the dashboard's own confirmation
 * dialog, not the browser's native `confirm()` (owner, 2026-09-22).
 *
 * Used for one-tap destructive actions on a busy service screen
 * (cancelling an order), where the point is that it costs a second and
 * cannot be mis-tapped. The dialog is portal'd to <body>, lives in client
 * state so the orders page's 10-second auto-refresh does not close it,
 * and Escape or the backdrop cancel. Confirming submits the SAME form
 * with this button as the submitter, so the server action — the
 * authority — runs exactly as a plain click would.
 *
 * Progressive enhancement is kept: with JavaScript off the click is not
 * intercepted and the form posts directly. The dialog guards the action;
 * it never gates it.
 */
export function ConfirmSubmit({
  message,
  children,
  pendingLabel = "Working…",
  className,
  title,
  confirmLabel = "Confirm",
  cancelLabel = "Back",
}: {
  /** What the dialog asks. Name the order — "Cancel order #0007?" — so a
   *  mis-tap on the wrong card is visible in the dialog itself. */
  message: string;
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  title?: string;
  /** The dialog's red button. */
  confirmLabel?: string;
  /** The dialog's way out. */
  cancelLabel?: string;
}): React.ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <SubmitButton
        ref={buttonRef}
        pendingLabel={pendingLabel}
        className={className}
        title={title}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </SubmitButton>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              role="alertdialog"
              aria-modal="true"
              aria-label={message}
            >
              {/* Click-outside to dismiss; hidden from assistive tech (the
                  dialog's own "back" button is the accessible way out). */}
              <div
                aria-hidden="true"
                onClick={() => setOpen(false)}
                className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              />
              <div className="relative w-full max-w-sm border border-ink/15 bg-card p-6 text-ink shadow-[0_32px_80px_-24px_rgba(0,0,0,0.6)]">
                <p className="font-serif text-xl leading-snug">{message}</p>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setOpen(false)}
                    className="border border-ink/25 px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink hover:border-ink/60"
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      const button = buttonRef.current;
                      // Submit the same form with this button as the
                      // submitter — the server action runs as for a click.
                      button?.form?.requestSubmit(button);
                    }}
                    className="border border-[#b3261e] bg-[#b3261e] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white hover:bg-[#8f1e18]"
                  >
                    {confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
