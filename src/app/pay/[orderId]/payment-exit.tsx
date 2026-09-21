"use client";

import { useEffect, useRef, useState } from "react";

/** Words for the dialog, resolved for the guest's language by `page.tsx`
 *  (a client component never imports the whole catalogue). */
export interface PaymentExitLabels {
  title: string;
  body: string;
  tryCard: string;
  payCash: string;
  cancel: string;
  cancelConfirm: string;
  working: string;
  stillProcessing: string;
  alreadyPaid: string;
  failed: string;
  close: string;
  otherOptions: string;
}

type Choice = "card" | "cash" | "cancel";

/**
 * "Payment not completed" — the guest's way forward when a card or PayPal
 * payment failed, was declined or was abandoned: try the card again, pay
 * cash at the restaurant (which sends the order to the kitchen), or cancel.
 *
 * A native <dialog>, opened automatically when the guest has just come
 * back from a failed / cancelled payment, and re-openable from the page.
 * Every choice is decided by the SERVER (`/pay-cash`, `/cancel`, `/pay`),
 * which re-checks the order and the gateway; this is only the UI.
 */
export function PaymentExit({
  orderId,
  token,
  acceptsCash,
  cardAvailable,
  autoOpen,
  labels,
}: {
  orderId: string;
  token: string;
  acceptsCash: boolean;
  cardAvailable: boolean;
  autoOpen: boolean;
  labels: PaymentExitLabels;
}): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (autoOpen && ref.current && !ref.current.open) ref.current.showModal();
  }, [autoOpen]);

  async function act(choice: Choice): Promise<void> {
    if (choice === "cancel" && !window.confirm(labels.cancelConfirm)) return;
    setBusy(choice);
    setMessage(null);
    const url =
      choice === "card"
        ? `/api/orders/${encodeURIComponent(orderId)}/pay`
        : `/api/v1/orders/${encodeURIComponent(orderId)}/${choice === "cash" ? "pay-cash" : "cancel"}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok && choice === "card" && body?.url) {
        location.href = body.url;
        return;
      }
      if (res.ok) {
        // Cash or cancelled: the page re-renders the new state.
        location.reload();
        return;
      }
      setMessage(
        body?.error === "processing"
          ? labels.stillProcessing
          : body?.error === "already_paid"
            ? labels.alreadyPaid
            : labels.failed,
      );
      if (body?.error === "already_paid") location.reload();
    } catch {
      setMessage(labels.failed);
    }
    setBusy(null);
  }

  const button =
    "block w-full px-4 py-3.5 text-center text-sm font-semibold transition disabled:opacity-60";

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="mt-6 text-sm text-orange-dark underline underline-offset-2"
      >
        {labels.otherOptions}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="payment-exit-title"
        className="m-auto w-[min(92vw,26rem)] border border-ink/15 bg-cream p-0 text-ink backdrop:bg-black/50"
      >
        <div className="p-6">
          <h2 id="payment-exit-title" className="font-serif text-2xl">
            {labels.title}
          </h2>
          <p className="mt-2 text-sm text-muted">{labels.body}</p>
          <div className="mt-5 space-y-3">
            {cardAvailable ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act("card")}
                className={`${button} bg-orange text-card hover:bg-orange-dark`}
              >
                {busy === "card" ? labels.working : labels.tryCard}
              </button>
            ) : null}
            {acceptsCash ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act("cash")}
                className={`${button} border-2 border-[#3f7030] text-[#3f7030] hover:bg-[#3f7030]/10`}
              >
                {busy === "cash" ? labels.working : labels.payCash}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act("cancel")}
              className={`${button} border border-[#b3261e]/60 text-[#b3261e] hover:bg-[#b3261e]/10`}
            >
              {busy === "cancel" ? labels.working : labels.cancel}
            </button>
          </div>
          {message ? (
            <p role="alert" className="mt-4 text-sm text-[#b3261e]">
              {message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="mt-5 w-full text-center text-sm text-muted underline underline-offset-2"
          >
            {labels.close}
          </button>
        </div>
      </dialog>
    </>
  );
}
