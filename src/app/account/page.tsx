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

  const dt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
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
