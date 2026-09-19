"use client";

import { useState } from "react";
import { MessagePopup } from "@/components/message-popup";

/** The three strings this button says, resolved for the guest's language
 *  by `page.tsx` (P7-16: a client component never imports a five-locale
 *  catalogue). */
export interface PayPalButtonLabels {
  pay: string;
  opening: string;
  failed: string;
}

/** Starts the PayPal approve flow — the guest bounces to PayPal (or the
 *  fake's instant return leg in dev) and lands back here settled. */
export function PayPalButton({
  orderId,
  token,
  appReturnUrl,
  labels,
}: {
  orderId: string;
  token: string;
  appReturnUrl?: string | null;
  labels: PayPalButtonLabels;
}): React.ReactElement {
  const [state, setState] = useState<"idle" | "starting" | "error">("idle");

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={state === "starting"}
        onClick={async () => {
          setState("starting");
          try {
            const res = await fetch(`/api/orders/${orderId}/pay/paypal`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, ...(appReturnUrl ? { app: appReturnUrl } : {}) }),
            });
            const body = (await res.json()) as { url?: string };
            if (res.ok && body.url) {
              location.href = body.url;
              return;
            }
            setState("error");
          } catch {
            setState("error");
          }
        }}
        className="block w-full border-2 border-[#003087] bg-[#ffc439] px-4 py-3.5 text-center text-sm font-bold uppercase tracking-[0.18em] rtl:normal-case rtl:tracking-normal text-[#003087] transition hover:opacity-90 active:scale-[0.985] disabled:opacity-60"
      >
        {state === "starting" ? labels.opening : labels.pay}
      </button>
      {state === "error" ? <MessagePopup kind="error" text={labels.failed} /> : null}
    </div>
  );
}
