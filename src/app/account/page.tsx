import type { Metadata } from "next";
import { FlashMessage } from "@/components/flash-message";
import Link from "next/link";
import { cookies } from "next/headers";
import { CUSTOMER_COOKIE, customerProviders, verifyCustomerToken } from "@/lib/customer-auth";
import { resolvePreviewContext } from "@/lib/preview-context";
import { getRestaurantSlug } from "@/lib/restaurant";
import { signReceiptToken } from "@/lib/receipt-token";
import { asTenant } from "@/lib/tenant";
import { formatPrice } from "@/lib/public-menu";
import { getLoyaltySummary } from "@/lib/loyalty-service";
import { loginCustomerAction, logoutCustomerAction, registerCustomerAction } from "./actions";

/**
 * Mein Konto — the guest account page. Signed out: the provider buttons
 * (Google, Microsoft/Hotmail, and the local dev login outside prod).
 * Signed in: profile + this customer's orders ACROSS devices, each with
 * live tracking and receipt links. Never cached; reads the customer
 * cookie only here — the menu pages stay cookie-agnostic.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mein Konto", robots: { index: false } };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; error?: string; app?: string }>;
}): Promise<React.ReactElement> {
  const { welcome, error, app } = await searchParams;
  const slug = await getRestaurantSlug();
  const context = await resolvePreviewContext(slug, null);
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE)?.value;
  const customer = context ? await verifyCustomerToken(context.tenantId, token) : null;

  const orders =
    context && customer
      ? await asTenant(context.tenantId, (tx) =>
          tx.order.findMany({
            where: { customerId: customer.id },
            orderBy: { createdAt: "desc" },
            take: 25,
            select: {
              id: true,
              orderNumber: true,
              status: true,
              orderType: true,
              paymentStatus: true,
              totalCents: true,
              currency: true,
              createdAt: true,
            },
          }),
        )
      : [];

  // Loyalty, round one: read-only. Earning happens on the order paths;
  // this card just shows what the guest has. Hidden entirely when the
  // owner has not switched loyalty on.
  const loyalty =
    context && customer ? await getLoyaltySummary(context.tenantId, customer.id) : null;
  const showLoyalty = Boolean(loyalty?.enabled);

  const dt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const dOnly = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
  const voucherStatus: Record<string, string> = {
    available: "verfügbar / available",
    armed: "vorgemerkt / armed",
    redeemed: "eingelöst / redeemed",
    expired: "abgelaufen / expired",
    revoked: "zurückgezogen / revoked",
  };
  const reasonLabel: Record<string, string> = {
    order: "Bestellung / order",
    reversal: "Storno / reversal",
    voucher: "Gutschein / voucher",
    redeem: "Gutschein eingelöst / reward used",
    adjust: "Korrektur / adjustment",
  };
  const typeLabel: Record<string, string> = {
    dine_in: "Im Restaurant",
    takeaway: "Abholung",
    delivery: "Lieferung",
  };

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-cream px-6 py-14 text-ink">
      <p className="text-xs uppercase tracking-[0.28em] text-gold-dark">Rangla Punjab</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight">Mein Konto · My account</h1>

      {welcome ? (
        <FlashMessage
          kind="success"
          text={`Willkommen! Du bist angemeldet.${app ? " Du kannst dieses Fenster schließen — die App ist jetzt angemeldet." : ""}`}
        />
      ) : null}
      {error ? (
        <FlashMessage
          kind="error"
          text={
            error === "exists"
              ? "Diese E-Mail hat bereits ein Konto — bitte anmelden. / This email already has an account — sign in instead."
              : error === "register"
                ? "Registrierung fehlgeschlagen — bitte Angaben prüfen. / Sign-up failed — check your details."
                : "Anmeldung fehlgeschlagen — bitte erneut versuchen. / Sign-in failed, please try again."
          }
        />
      ) : null}

      {!customer ? (
        <section className="mt-8 space-y-3">
          <p className="text-sm text-muted">
            Melde dich an, um deine Bestellungen auf allen Geräten zu sehen. / Sign in to see your
            orders on every device.
          </p>
          {customerProviders().map((p) => (
            <a
              key={p.id}
              href={`/api/auth/customer/${p.id}/start`}
              className="block w-full border border-ink/20 bg-card px-5 py-3.5 text-center text-sm font-semibold hover:border-ink/50"
            >
              {p.id === "google" ? "Mit Google anmelden" : null}
              {p.id === "dev" ? "Dev-Login (nur lokal)" : null}
            </a>
          ))}

          <p className="pt-2 text-center text-xs uppercase tracking-[0.2em] text-muted">
            oder mit E-Mail / or with email
          </p>
          <form className="space-y-3 border border-ink/15 bg-card px-5 py-4">
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-[0.14em] text-muted">E-Mail</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                className="mt-1 block w-full border border-ink/25 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-[0.14em] text-muted">
                Passwort (min. 8 Zeichen)
              </span>
              <input
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="current-password"
                className="mt-1 block w-full border border-ink/25 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-[0.14em] text-muted">
                Name (nur bei Registrierung / sign-up only)
              </span>
              <input
                type="text"
                name="name"
                maxLength={80}
                autoComplete="name"
                className="mt-1 block w-full border border-ink/25 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
            </label>
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                formAction={loginCustomerAction}
                className="flex-1 bg-ink px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-card hover:opacity-90"
              >
                Anmelden / Sign in
              </button>
              <button
                type="submit"
                formAction={registerCustomerAction}
                className="flex-1 border border-ink/30 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] hover:border-ink"
              >
                Registrieren / Sign up
              </button>
            </div>
          </form>
          <p className="text-xs text-muted">
            Kein Konto nötig zum Bestellen — die Anmeldung ist optional. / Ordering works without an
            account; signing in is optional.
          </p>
        </section>
      ) : (
        <section className="mt-8">
          <div className="border border-ink/15 bg-card px-5 py-4">
            <p className="font-medium">{customer.name ?? customer.email}</p>
            <p className="text-sm text-muted">{customer.email}</p>
            <form action={logoutCustomerAction} className="mt-3">
              <button type="submit" className="text-sm underline underline-offset-2">
                Abmelden / Sign out
              </button>
            </form>
          </div>

          {showLoyalty && loyalty ? (
            <section aria-label="Rewards" className="mt-8 border border-ink/15 bg-card px-5 py-4">
              <h2 className="font-serif text-2xl">Treuepunkte · Rewards</h2>
              <p className="mt-1 text-sm text-muted">
                {loyalty.pointsPerOrder} Punkte pro Bestellung ab{" "}
                {formatPrice(loyalty.minOrderCents, "EUR", "de")} · {loyalty.rewardPoints} Punkte
                ergeben {formatPrice(loyalty.rewardValueCents, "EUR", "de")} geschenkt.
              </p>

              <p className="mt-4 font-serif text-3xl tabular-nums">
                {loyalty.balance}{" "}
                <span className="font-sans text-sm text-muted">
                  / {loyalty.rewardPoints} Punkte
                </span>
              </p>
              {/* Two divs rather than <progress>: the native element's
                  fill can only be themed through vendor pseudo-elements,
                  and it shipped as browser-default green against the
                  cream/gold identity. ARIA supplies everything the native
                  element would have, and it still needs no JS. */}
              <div
                role="progressbar"
                aria-valuenow={Math.min(loyalty.balance, loyalty.rewardPoints)}
                aria-valuemin={0}
                aria-valuemax={loyalty.rewardPoints}
                aria-label="Fortschritt zur nächsten Belohnung / progress to your next reward"
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink/10"
              >
                <div
                  className="h-full rounded-full bg-orange"
                  style={{
                    width: `${loyalty.rewardPoints > 0 ? Math.min(100, (loyalty.balance / loyalty.rewardPoints) * 100) : 0}%`,
                  }}
                />
              </div>

              <h3 className="mt-6 text-xs uppercase tracking-[0.2em] text-gold-dark">
                Gutscheine / vouchers
              </h3>
              {loyalty.vouchers.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Noch keine Gutscheine. / No vouchers yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-ink/10 border border-ink/15">
                  {loyalty.vouchers.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold tabular-nums">
                        {formatPrice(v.valueCents, "EUR", "de")}
                      </span>
                      <span className="text-muted">
                        {v.status === "redeemed" && v.redeemedOrderNumber !== null
                          ? `eingelöst für Bestellung #${String(v.redeemedOrderNumber).padStart(4, "0")} / used on order #${String(v.redeemedOrderNumber).padStart(4, "0")}`
                          : `gültig bis ${dOnly.format(new Date(v.expiresAt))}`}
                      </span>
                      <span className="ml-auto rounded-full border border-ink/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
                        {voucherStatus[v.status] ?? v.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-6 text-xs uppercase tracking-[0.2em] text-gold-dark">
                Verlauf / history
              </h3>
              {loyalty.history.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  Noch keine Punktebewegungen. / No points movements yet.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-ink/10 border border-ink/15">
                  {loyalty.history.map((h) => (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold tabular-nums">
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </span>
                      <span className="text-muted">
                        {reasonLabel[h.reason] ?? h.reason}
                        {/* The voucher's OWN value, so an owner raising the
                            reward never rewrites what past lines say. */}
                        {h.valueCents !== null
                          ? ` · ${formatPrice(h.valueCents, "EUR", "de")}`
                          : ""}
                      </span>
                      {h.orderNumber !== null ? (
                        <span className="text-muted">
                          #{String(h.orderNumber).padStart(4, "0")}
                        </span>
                      ) : null}
                      <span className="ml-auto text-muted">{dt.format(new Date(h.createdAt))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <h2 className="mt-8 font-serif text-2xl">Meine Bestellungen · My orders</h2>
          {orders.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Noch keine Bestellungen mit diesem Konto. / No orders with this account yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-ink/10 border border-ink/15 bg-card">
              {orders.map((o) => {
                const t = context ? signReceiptToken(o.id, context.tenantId) : "";
                return (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm"
                  >
                    <span className="font-semibold">#{String(o.orderNumber).padStart(4, "0")}</span>
                    <span className="text-muted">{dt.format(o.createdAt)}</span>
                    <span className="text-muted">{typeLabel[o.orderType] ?? o.orderType}</span>
                    <span className="tabular-nums font-semibold">
                      {formatPrice(o.totalCents, o.currency, "de")}
                    </span>
                    <span className="rounded-full border border-ink/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
                      {o.status.replaceAll("_", " ")}
                    </span>
                    <span className="ml-auto flex gap-3">
                      <Link
                        className="underline underline-offset-2"
                        href={`/order-status/${o.id}?token=${encodeURIComponent(t)}`}
                      >
                        Verfolgen
                      </Link>
                      <a
                        className="underline underline-offset-2"
                        href={`/api/orders/${o.id}/receipt?token=${encodeURIComponent(t)}&locale=de`}
                      >
                        Beleg
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <p className="mt-10 text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Zur Speisekarte / back to the menu
        </Link>
      </p>
    </main>
  );
}
