"use client";

import { useEffect, useRef, useState } from "react";
import type { PaymentRequest, StripeElement } from "@stripe/stripe-js";

/** The handle on a placed order the wallet flow needs: the id to fetch a
 *  PaymentIntent for, and the HMAC receipt token that authorises it. */
export interface WalletOrder {
  orderId: string;
  receiptToken: string;
}

export interface WalletPayButtonProps {
  /** Stripe publishable key for the SAME account that will issue the
   *  intent (from `/api/v1/pay/wallet-config`). */
  publishableKey: string;
  /** ⛔ Apple Pay on the web needs a verified merchant domain (the server
   *  decides that) AND the owner's tick in Settings → "Payment methods
   *  you accept" — the caller passes the AND of the two. */
  allowApplePay: boolean;
  /** The owner ticked Google Pay in Settings → "Payment methods you
   *  accept". Google Pay needs no domain verification, so this tick is
   *  the whole gate on our side. */
  allowGooglePay: boolean;
  /** Merchant country for the payment request (ISO-3166-1 alpha-2). */
  country: string;
  /** ISO currency of the order — Stripe wants it lower-case. */
  currency: string;
  /** Live order total in integer cents; kept in sync as the basket changes. */
  totalCents: number;
  /** What the wallet sheet calls this charge (the restaurant's name). */
  label: string;
  /** Details missing / below minimum / a payment already running. */
  disabled: boolean;
  /** Place the order server-side and hand back its id + token, or null
   *  when it could not be placed (the caller has shown the reason). */
  placeOrder: () => Promise<WalletOrder | null>;
  /** The wallet charge succeeded. */
  onPaid: (order: WalletOrder) => void;
  /** Something after "order placed" went wrong — already-localised text. */
  onError: (message: string) => void;
  /** Localised message for a failed wallet charge. */
  errorText: string;
}

/**
 * Apple Pay / Google Pay, as a real platform-pay button (P7-13).
 *
 * This is a SEPARATE module from the cart drawer on purpose: it is the
 * only thing that imports `@stripe/stripe-js`, and the drawer pulls it in
 * with `next/dynamic` only once the server has said there is a
 * publishable key. A guest on a venue without Stripe — or in a browser
 * with no wallet — never downloads a byte of it, which is what keeps the
 * guest bundle inside its budget.
 *
 * It renders NOTHING until `canMakePayment()` has resolved truthy AND the
 * wallet the browser offers is one we are allowed to show — which means
 * both that the restaurant ticked it in its settings and, for Apple Pay,
 * that the merchant domain is verified. Safari with an unverified domain,
 * or Chrome at a venue that only takes Apple Pay, therefore gets no
 * button at all, rather than one that opens a sheet and fails at
 * confirmation.
 *
 * The flow when it IS tapped mirrors the card tile: place the order first
 * (the server re-prices everything), then fetch that order's
 * PaymentIntent from `/api/orders/{id}/pay/intent` and confirm it with
 * the payment method the wallet handed us. The order exists either way —
 * a failed charge leaves the guest on the confirmation screen with the
 * ordinary pay buttons, never with money taken and no order.
 */
export function WalletPayButton({
  publishableKey,
  allowApplePay,
  allowGooglePay,
  country,
  currency,
  totalCents,
  label,
  disabled,
  placeOrder,
  onPaid,
  onError,
  errorText,
}: WalletPayButtonProps): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<PaymentRequest | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Stripe's `paymentmethod` listener is registered once, but it has to
   * run against the CURRENT basket and the current callbacks — so it
   * reads them out of a ref that every render refreshes, instead of
   * closing over the render it was created in.
   */
  const live = useRef({ disabled, placeOrder, onPaid, onError, errorText, totalCents, label });
  useEffect(() => {
    live.current = { disabled, placeOrder, onPaid, onError, errorText, totalCents, label };
  });

  useEffect(() => {
    let cancelled = false;
    let element: StripeElement | null = null;

    void (async () => {
      // Dynamic: `loadStripe` injects js.stripe.com, and nothing about
      // that should happen on a menu nobody is paying from.
      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(publishableKey);
      if (!stripe || cancelled) return;

      const request = stripe.paymentRequest({
        country,
        currency: currency.toLowerCase(),
        total: { label: live.current.label, amount: live.current.totalCents },
        // The order already carries the guest's name, phone and address;
        // asking the wallet for them again would only give us a second,
        // conflicting copy to reconcile.
        requestPayerName: false,
        requestPayerEmail: false,
      });

      const available = await request.canMakePayment();
      if (!available || cancelled) return;
      // `link` is Stripe Link, not a platform wallet — it is not what the
      // owner asked for and it is not gated by anything, so it alone is
      // never a reason to draw this button. Each real wallet needs BOTH
      // the device to offer it and the restaurant to have ticked it.
      if (!(available.googlePay && allowGooglePay) && !(available.applePay && allowApplePay))
        return;

      request.on("paymentmethod", (ev) => {
        void (async () => {
          const now = live.current;
          if (now.disabled) {
            ev.complete("fail");
            return;
          }
          try {
            const order = await now.placeOrder();
            if (!order) {
              ev.complete("fail");
              return;
            }
            const res = await fetch(`/api/orders/${order.orderId}/pay/intent`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: order.receiptToken }),
            });
            const body = (await res.json().catch(() => null)) as {
              clientSecret?: string;
            } | null;
            if (!res.ok || !body?.clientSecret) {
              ev.complete("fail");
              now.onError(now.errorText);
              return;
            }
            // `handleActions: false` so the wallet sheet closes on our
            // word rather than sitting open behind a 3-D Secure step.
            const first = await stripe.confirmCardPayment(
              body.clientSecret,
              { payment_method: ev.paymentMethod.id },
              { handleActions: false },
            );
            if (first.error) {
              ev.complete("fail");
              now.onError(now.errorText);
              return;
            }
            ev.complete("success");
            if (first.paymentIntent?.status === "requires_action") {
              const second = await stripe.confirmCardPayment(body.clientSecret);
              if (second.error) {
                now.onError(now.errorText);
                return;
              }
            }
            now.onPaid(order);
          } catch {
            ev.complete("fail");
            now.onError(now.errorText);
          }
        })();
      });

      const node = mountRef.current;
      if (!node || cancelled) return;
      element = stripe.elements().create("paymentRequestButton", {
        paymentRequest: request,
        style: { paymentRequestButton: { type: "default", theme: "dark", height: "48px" } },
      });
      element.mount(node);
      requestRef.current = request;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      element?.destroy();
      requestRef.current = null;
      setReady(false);
    };
  }, [publishableKey, allowApplePay, allowGooglePay, country, currency]);

  // The basket is live behind the open sheet: keep the amount the wallet
  // will show in step with it, or the guest approves yesterday's total.
  useEffect(() => {
    requestRef.current?.update({ total: { label, amount: totalCents } });
  }, [totalCents, label]);

  return (
    <div
      className={
        ready
          ? disabled
            ? "mt-4 pointer-events-none opacity-50"
            : "mt-4"
          : // Present but out of the way until Stripe answers: the
            // element needs a real node to mount into, and `display:none`
            // would leave it unable to measure itself.
            "pointer-events-none h-0 overflow-hidden opacity-0"
      }
      aria-hidden={ready ? undefined : true}
    >
      <div ref={mountRef} />
    </div>
  );
}
