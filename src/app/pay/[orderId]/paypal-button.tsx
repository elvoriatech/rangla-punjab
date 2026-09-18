"use client";

import { useState } from "react";
import { MessagePopup } from "@/components/message-popup";
import { postOrderCopy } from "@/lib/i18n/post-order";

/** Starts the PayPal approve flow — the guest bounces to PayPal (or the
 *  fake's instant return leg in dev) and lands back here settled. */
export function PayPalButton({
  orderId,
  token,
  appReturnUrl,
  locale,
}: {
  orderId: string;
  token: string;
  appReturnUrl?: string | null;
  /** Resolved by the page (query param or venue default). */
  locale: string;
}): React.ReactElement {
  const [state, setState] = useState<"idle" | "starting" | "error">("idle");
  const t = postOrderCopy(locale);

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
        {state === "starting" ? t.openingPaypal : t.payWithPaypal}
      </button>
      {state === "error" ? <MessagePopup kind="error" text={t.paypalFailed} /> : null}
    </div>
  );
}
