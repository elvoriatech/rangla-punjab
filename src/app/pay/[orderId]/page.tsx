import { notFound } from "next/navigation";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { getOrderForReceipt } from "@/lib/order-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { formatPrice } from "@/lib/public-menu";
import { PayButton } from "./pay-button";
import { PayPalButton } from "./paypal-button";
import { paypalAvailable } from "@/lib/paypal";
import { VAT_RATE_LABEL, vatFromGross } from "@/lib/vat";

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
  searchParams: Promise<{ token?: string; ref?: string; status?: string; app?: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  const { token, ref, app } = await searchParams;
  // Opened from the mobile app? Then the settled state leads back there.
  const appReturnUrl = sanitizeAppReturnUrl(app);
  if (!token) notFound();
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId) notFound();

  const order = await getOrderForReceipt(verified.tenantId, orderId);
  if (!order) notFound();

  const money = (cents: number): string => formatPrice(cents, order.currency, "de");
  const paid = order.paymentStatus === "paid";
  const vatCents = vatFromGross(order.totalCents);
  // P2-4: site kill switch — no new payments while paused (a settled order
  // still shows its paid state below).
  const { siteActive } = await getOperatorSettings();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-cream px-6 py-16 text-ink">
      <p className="text-xs uppercase tracking-[0.28em] text-gold-dark">{order.venue.name}</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">
        Bestellung Nr. {String(order.orderNumber).padStart(4, "0")}
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
        {/* German gross pricing: VAT is contained in the total, shown as a
            split so the page doubles as the guest's receipt. */}
        <li className="flex items-baseline justify-between gap-3 px-4 pt-2.5 text-xs text-muted">
          <span>Netto</span>
          <span className="tabular-nums">{money(order.totalCents - vatCents)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 px-4 pb-1 text-xs text-muted">
          <span>MwSt. {VAT_RATE_LABEL} % (enthalten)</span>
          <span className="tabular-nums">{money(vatCents)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm font-semibold">
          <span className="uppercase tracking-[0.16em]">Gesamt</span>
          <span className="tabular-nums">{money(order.totalCents)}</span>
        </li>
      </ul>

      {paid ? (
        <div className="mt-6 border border-[#3f7030]/40 bg-[#3f7030]/10 px-4 py-4 text-center">
          <p className="font-serif text-2xl text-[#3f7030]">Bezahlt ✓</p>
          <p className="mt-1 text-sm text-muted">
            Zeigen Sie diesen Bildschirm bei Bedarf im Restaurant vor — die Küche sieht die
            Bestellung als bezahlt.
          </p>
          {appReturnUrl ? (
            <a
              href={appReturnUrl}
              className="mt-4 block w-full bg-orange px-4 py-3.5 text-center text-sm font-semibold uppercase tracking-[0.18em] text-card transition hover:bg-orange-dark"
            >
              Zurück zur App / Back to the app
            </a>
          ) : (
            <a
              href={`/`}
              className="mt-4 inline-block text-sm text-orange-dark underline underline-offset-2"
            >
              Zurück zur Speisekarte
            </a>
          )}
        </div>
      ) : !siteActive ? (
        <div className="mt-6 border border-ink/15 bg-card px-4 py-4 text-center">
          <p className="font-serif text-2xl">Bestellungen pausiert</p>
          <p className="mt-1 text-sm text-muted">
            Online-Zahlungen sind gerade pausiert. Bitte zahlen Sie im Restaurant oder versuchen Sie
            es später erneut.
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
          {paypalAvailable() ? (
            <PayPalButton orderId={orderId} token={token} appReturnUrl={appReturnUrl} />
          ) : null}
          {!ref && !paypalAvailable() ? (
            <p className="mt-6 text-sm text-muted">
              Dieser Zahlungslink ist unvollständig — bitte starten Sie erneut über Ihre
              Bestellbestätigung.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
