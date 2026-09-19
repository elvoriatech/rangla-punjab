"use client";

import { SubmitButton } from "./submit-button";

/**
 * A submit button that asks first.
 *
 * Deliberately NOT a modal: the guard exists for one-tap destructive
 * actions on a busy service screen (cancelling an order), where the whole
 * point is that it costs a second and cannot be mis-tapped. A native
 * `confirm()` is the only dialog that is already keyboard-accessible,
 * already announced, and cannot be dismissed by the page re-rendering
 * underneath it on the next 7-second auto-refresh.
 *
 * Progressive enhancement is the reason it is a click guard rather than a
 * submit handler: with JavaScript off there is no dialog and the form
 * posts exactly as it would have — the server action is the authority,
 * and a kitchen tablet with a broken bundle must still be able to cancel
 * an order. The dialog guards the action; it never gates it.
 */
export function ConfirmSubmit({
  message,
  children,
  pendingLabel = "Working…",
  className,
  title,
}: {
  /** What the dialog asks. Name the order — "Cancel order #0007?" — so a
   *  mis-tap on the wrong card is visible in the dialog itself. */
  message: string;
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  title?: string;
}): React.ReactElement {
  return (
    <SubmitButton
      pendingLabel={pendingLabel}
      className={className}
      title={title}
      onClick={(event) => {
        // `confirm` is absent in some embedded webviews; a missing dialog
        // must not swallow the click.
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
          if (!window.confirm(message)) event.preventDefault();
        }
      }}
    >
      {children}
    </SubmitButton>
  );
}
