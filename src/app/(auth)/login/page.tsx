import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { venueAdminBase } from "@/lib/venue-service";
import { loginAction } from "./actions";

export const metadata: Metadata = {
  title: `Log in — ${BRAND.name}`,
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Please enter a valid email address and password.",
  invalid_credentials: "That email and password combination doesn't match our records.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
};

/**
 * Split-screen login: the brand world on the left (espresso panel,
 * serif thesis, three proof points), the form on the right. The left
 * pane disappears below lg — phones get a compact brand header instead.
 * Form mechanics unchanged: plain POST server action, no client JS.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}): Promise<React.ReactElement> {
  // Already signed in → straight to where they work: platform staff to
  // the console, owners to their restaurant.
  const userId = await getSessionUserId();
  if (userId) {
    if (await isPlatformAdmin(userId)) redirect("/admin");
    redirect((await venueAdminBase(userId)) ?? "/dashboard");
  }

  const { error, reset } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.invalid) : null;
  const noticeMessage = reset ? "Password updated — log in with your new password." : null;

  return (
    <main className="flex min-h-screen bg-cream text-ink">
      {/* Brand pane — the thesis, not a decoration. */}
      <aside
        aria-hidden="true"
        className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-brand-espresso p-12 text-brand-warm-cream lg:flex"
      >
        {/* Quiet jali-style lattice, drawn inline so nothing loads. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 72 72'%3E%3Cg fill='none' stroke='%23ecdcb6' stroke-width='1'%3E%3Cpath d='M36 6 66 36 36 66 6 36Z'/%3E%3Ccircle cx='36' cy='36' r='12'/%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
            <span className="text-sm uppercase tracking-[0.34em] text-gold">{BRAND.name}</span>
          </div>
          <h2 className="mt-14 max-w-md font-serif text-[2.6rem] font-medium leading-[1.15]">
            The menu your guests scan, read&nbsp;— and order from.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-brand-warm-cream/70">
            One QR code on the table. Menus in ten languages, orders straight to your kitchen,
            receipts on the guest&apos;s phone.
          </p>
        </div>

        <ul className="relative space-y-4 text-sm text-brand-warm-cream/85">
          {(
            [
              ["🍽", "Guests order from the table — no app, no sign-up"],
              ["🖥", "Kitchen display rings the moment an order lands"],
              ["🧾", "Publish a price change in seconds, everywhere at once"],
            ] as const
          ).map(([icon, text]) => (
            <li key={text} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 text-[13px]">
                {icon}
              </span>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ul>

        <p className="relative text-[11px] uppercase tracking-[0.3em] text-brand-warm-cream/40">
          EU-hosted · GDPR-first · Made for restaurants
        </p>
      </aside>

      {/* Form pane */}
      <section className="flex flex-1 flex-col justify-center px-6 py-14 sm:px-12">
        <div className="menu-hero mx-auto w-full max-w-sm">
          {/* Compact brand header for screens without the left pane. */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
            <span className="text-xs uppercase tracking-[0.34em] text-gold-dark">{BRAND.name}</span>
          </div>

          <p className="text-xs uppercase tracking-[0.28em] text-gold-dark">Welcome back</p>
          <h1 className="mt-2 font-serif text-4xl leading-tight">Log in</h1>
          <p className="mt-2 text-sm text-muted">
            Manage your menu, publish changes, and watch orders come in.
          </p>

          {noticeMessage ? (
            <p
              role="status"
              className="mt-6 border-l-4 border-emerald-700/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
            >
              {noticeMessage}
            </p>
          ) : null}

          {errorMessage ? (
            <p
              role="alert"
              className="mt-6 border-l-4 border-red-800/60 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              {errorMessage}
            </p>
          ) : null}

          <form action={loginAction} className="mt-8 flex flex-col gap-5">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Email</span>
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                placeholder="you@yourrestaurant.de"
                className="border border-ink/25 bg-white px-3.5 py-2.5 text-base outline-none transition-colors placeholder:text-ink/30 focus:border-gold-dark focus:ring-2 focus:ring-gold/30"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="flex items-baseline justify-between">
                <span className="font-medium">Password</span>
                <Link
                  href="/reset"
                  className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                >
                  Forgot it?
                </Link>
              </span>
              <input
                type="password"
                name="password"
                required
                maxLength={1024}
                autoComplete="current-password"
                className="border border-ink/25 bg-white px-3.5 py-2.5 text-base outline-none transition-colors focus:border-gold-dark focus:ring-2 focus:ring-gold/30"
              />
            </label>
            <button
              type="submit"
              className="mt-2 bg-orange px-4 py-3.5 text-sm font-semibold uppercase tracking-[0.18em] text-card shadow-[0_10px_24px_-12px_rgba(194,90,34,0.65)] transition hover:bg-orange-dark active:scale-[0.985]"
            >
              Log in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
