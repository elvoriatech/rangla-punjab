import { notFound } from "next/navigation";
import { getOrderForReceipt } from "@/lib/order-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { formatPrice } from "@/lib/public-menu";
import { PayButton } from "./pay-button";
import { PayPalButton } from "./paypal-button";
import { paypalAvailable } from "@/lib/paypal";

/**
 * Local payment page. With the FAKE provider this is where the guest
 * "pays" (dev/CI end-to-end flow); with the real provider guests go to
 * Stripe-hosted checkout instead and only land here on the success
 * bounce (?status=success), where the page shows the settled state.
 * Access is gated by the order's HMAC receipt token.
 */

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string; ref?: string; status?: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  const { token, ref } = await searchParams;
  if (!token) notFound();
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId) notFound();

  const order = await getOrderForReceipt(verified.tenantId, orderId);
  if (!order) notFound();

  const money = (cents: number): string => formatPrice(cents, order.currency, "de");
  const paid = order.paymentStatus === "paid";
  // P2-4: site kill switch — no new payments while paused (a settled order
  // still shows its paid state below).
  const { siteActive } = await getOperatorSettings();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-cream px-6 py-16 text-ink">
      <p className="text-xs uppercase tracking-[0.28em] text-gold-dark">{order.venue.name}</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">
        Order #{String(order.orderNumber).padStart(4, "0")}
      </h1>

      <ul className="mt-6 divide-y divide-ink/10 border border-ink/15 bg-card">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
            <span>
              {item.quantity}× {item.name}
            </span>
            <span className="tabular-nums">{money(item.priceCents * item.quantity)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm font-semibold">
          <span className="uppercase tracking-[0.16em]">Total</span>
          <span className="tabular-nums">{money(order.totalCents)}</span>
        </li>
      </ul>

      {paid ? (
        <div className="mt-6 border border-[#3f7030]/40 bg-[#3f7030]/10 px-4 py-4 text-center">
          <p className="font-serif text-2xl text-[#3f7030]">Paid ✓</p>
          <p className="mt-1 text-sm text-muted">
            Show this screen at the restaurant if asked — the kitchen sees the order as paid.
          </p>
          <a
            href={`/`}
            className="mt-4 inline-block text-sm text-orange-dark underline underline-offset-2"
          >
            Back to the menu
          </a>
        </div>
      ) : !siteActive ? (
        <div className="mt-6 border border-ink/15 bg-card px-4 py-4 text-center">
          <p className="font-serif text-2xl">Ordering paused</p>
          <p className="mt-1 text-sm text-muted">
            Online payments are paused right now. Please pay at the restaurant, or try again later.
          </p>
        </div>
      ) : (
        <>
          {ref ? (
            <PayButton
              orderId={orderId}
              token={token}
              payRef={ref}
              amountLabel={money(order.totalCents)}
            />
          ) : null}
          {paypalAvailable() ? <PayPalButton orderId={orderId} token={token} /> : null}
          {!ref && !paypalAvailable() ? (
            <p className="mt-6 text-sm text-muted">
              This payment link is incomplete — start again from your order confirmation.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
