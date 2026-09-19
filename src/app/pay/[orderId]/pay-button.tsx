"use client";

import { useState } from "react";
import { MessagePopup } from "@/components/message-popup";

/** The four strings this button says, resolved for the guest's language
 *  by `page.tsx` (P7-16: a client component never imports a five-locale
 *  catalogue). `pay` arrives with the amount already interpolated. */
export interface PayButtonLabels {
  pay: string;
  processing: string;
  failed: string;
  testNote: string;
}

/** Dev/fake-provider pay button — settles the checkout like Stripe's
 *  hosted page + webhook would in production. */
export function PayButton({
  orderId,
  token,
  payRef,
  labels,
}: {
  orderId: string;
  token: string;
  payRef: string;
  labels: PayButtonLabels;
}): React.ReactElement {
  const [state, setState] = useState<"idle" | "paying" | "error">("idle");

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={state === "paying"}
        onClick={async () => {
          setState("paying");
          try {
            const res = await fetch(`/api/orders/${orderId}/pay/confirm`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, ref: payRef }),
            });
            if (!res.ok) throw new Error(String(res.status));
            location.reload();
          } catch {
            setState("error");
          }
        }}
        className="block w-full bg-orange px-4 py-3.5 text-center text-sm font-semibold uppercase tracking-[0.18em] rtl:normal-case rtl:tracking-normal text-card transition hover:bg-orange-dark active:scale-[0.985] disabled:opacity-60"
      >
        {state === "paying" ? labels.processing : labels.pay}
      </button>
      {state === "error" ? <MessagePopup kind="error" text={labels.failed} /> : null}
      <p className="mt-3 text-center text-[11px] uppercase tracking-[0.2em] rtl:normal-case rtl:tracking-normal text-muted">
        {labels.testNote}
      </p>
    </div>
  );
}
