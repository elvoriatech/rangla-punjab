"use client";

import { useState } from "react";
import { MessagePopup } from "@/components/message-popup";
import { postOrderCopy } from "@/lib/i18n/post-order";

/** Dev/fake-provider pay button — settles the checkout like Stripe's
 *  hosted page + webhook would in production. */
export function PayButton({
  orderId,
  token,
  payRef,
  amountLabel,
  locale,
}: {
  orderId: string;
  token: string;
  payRef: string;
  amountLabel: string;
  /** Resolved by the page (query param or venue default). */
  locale: string;
}): React.ReactElement {
  const [state, setState] = useState<"idle" | "paying" | "error">("idle");
  const t = postOrderCopy(locale);

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
        {state === "paying" ? t.processing : t.payAmount(amountLabel)}
      </button>
      {state === "error" ? <MessagePopup kind="error" text={t.payFailed} /> : null}
      <p className="mt-3 text-center text-[11px] uppercase tracking-[0.2em] rtl:normal-case rtl:tracking-normal text-muted">
        {t.testPayPage}
      </p>
    </div>
  );
}
