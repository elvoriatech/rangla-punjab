import { notFound } from "next/navigation";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { getOrderForReceipt } from "@/lib/order-service";
import { getOperatorSettings } from "@/lib/operator-settings";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { formatPrice } from "@/lib/public-menu";
import { PayButton } from "./pay-button";
import { AutoReceipt } from "./auto-receipt";
import { PayPalButton } from "./paypal-button";
import { paypalAvailable } from "@/lib/paypal";
import { VAT_RATE_LABEL, vatFromGross } from "@/lib/vat";
import { postOrderCopy } from "@/lib/i18n/post-order";
import { dirFor, isLocaleCode, uiLocale } from "@/lib/locales";

/**
 * Local payment page. With the FAKE provider this is where the guest
 * "pays" (dev/CI end-to-end flow); with the real provider guests go to
 * Stripe-hosted checkout instead and only land here on the success
 * bounce (?status=success), where the page shows the settled state.
 * Access is gated by the order's HMAC receipt token.
 *
 * Language follows plan decision 5: a valid `?locale=` wins, else the
 * venue's default locale.
 */

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{
    token?: string;
    ref?: string;
    status?: string;
    app?: string;
    locale?: string;
  }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  const { token, ref, app, locale: localeParam } = await searchParams;
  // Opened from the mobile app? Then the settled state leads back there.
  const appReturnUrl = sanitizeAppReturnUrl(app);
  if (!token) notFound();
  const verified = verifyReceiptToken(token);
  if (!verified || verified.orderId !== orderId) notFound();

  const order = await getOrderForReceipt(verified.tenantId, orderId);
  if (!order) notFound();

  const locale = uiLocale(isLocaleCode(localeParam) ? localeParam : order.venue.defaultLocale);
  const t = postOrderCopy(locale);
  const money = (cents: number): string => formatPrice(cents, order.currency, locale);
  const paid = order.paymentStatus === "paid";
  const vatCents = vatFromGross(order.totalCents);
  const orderNo = String(order.orderNumber).padStart(4, "0");
  // P2-4: site kill switch — no new payments while paused (a settled order
  // still shows its paid state below).
  const { siteActive } = await getOperatorSettings();

  return (
    <main
      dir={dirFor(locale)}
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-cream px-6 py-16 text-ink"
    >
      {/* Arabic is cursive — `uppercase`/`letter-spacing` only damage it. */}
      <p className="text-xs uppercase tracking-[0.28em] rtl:normal-case rtl:tracking-normal text-gold-dark">
        {order.venue.name}
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">{t.orderHeading(orderNo)}</h1>

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
          <span>{t.net}</span>
          <span className="tabular-nums">{money(order.totalCents - vatCents)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 px-4 pb-1 text-xs text-muted">
          <span>{t.vatLine(VAT_RATE_LABEL)}</span>
          <span className="tabular-nums">{money(vatCents)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm font-semibold">
          <span className="uppercase tracking-[0.16em] rtl:normal-case rtl:tracking-normal">
            {t.total}
          </span>
          <span className="tabular-nums">{money(order.totalCents)}</span>
        </li>
      </ul>

      {paid ? (
        <div className="mt-6 border border-[#3f7030]/40 bg-[#3f7030]/10 px-4 py-4 text-center">
          <p className="font-serif text-2xl text-[#3f7030]">{t.paid}</p>
          <AutoReceipt
            href={`/api/orders/${encodeURIComponent(orderId)}/receipt?token=${encodeURIComponent(token)}&locale=${locale}`}
            filename={`${t.receiptFilePrefix}-${orderNo}.pdf`}
            label={t.downloadReceipt}
          />
          <p className="mt-1 text-sm text-muted">{t.showAtRestaurant}</p>
          {appReturnUrl ? (
            <a
              href={appReturnUrl}
              className="mt-4 block w-full bg-orange px-4 py-3.5 text-center text-sm font-semibold uppercase tracking-[0.18em] rtl:normal-case rtl:tracking-normal text-card transition hover:bg-orange-dark"
            >
              {t.backToApp}
            </a>
          ) : (
            <a
              href={`/`}
              className="mt-4 inline-block text-sm text-orange-dark underline underline-offset-2"
            >
              {t.backToMenu}
            </a>
          )}
        </div>
      ) : !siteActive ? (
        <div className="mt-6 border border-ink/15 bg-card px-4 py-4 text-center">
          <p className="font-serif text-2xl">{t.paused}</p>
          <p className="mt-1 text-sm text-muted">{t.pausedBody}</p>
        </div>
      ) : (
        <>
          {ref ? (
            <PayButton
              orderId={orderId}
              token={token}
              payRef={ref}
              amountLabel={money(order.totalCents)}
              locale={locale}
            />
          ) : null}
          {paypalAvailable() ? (
            <PayPalButton
              orderId={orderId}
              token={token}
              appReturnUrl={appReturnUrl}
              locale={locale}
            />
          ) : null}
          {!ref && !paypalAvailable() ? (
            <p className="mt-6 text-sm text-muted">{t.incompleteLink}</p>
          ) : null}
        </>
      )}
    </main>
  );
}
