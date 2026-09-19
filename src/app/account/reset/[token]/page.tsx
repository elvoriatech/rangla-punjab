import type { Metadata } from "next";
import Link from "next/link";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { BRAND } from "@/lib/brand";
import { CUSTOMER_PASSWORD_MIN_LENGTH } from "@/lib/customer-password-reset";
import { postOrderCopy } from "@/lib/i18n/post-order";
import { dirFor } from "@/lib/locales";
import { accountLocale } from "../../locale";
import { resetCustomerPasswordAction } from "./actions";

/**
 * Where the emailed link lands: choose a new password, twice.
 *
 * The token stays in the PATH (it arrived that way) and rides along in a
 * hidden field, so the form works with JS off — and so does the whole
 * page: errors round-trip through the query string rather than through
 * client state. The page never says whether the token is valid before
 * the form is submitted; a guest holding a dead link learns that from
 * the action, together with what to do about it.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `Neues Passwort · ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default async function CustomerResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; locale?: string; app?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const { error, locale: localeParam, app: appParam } = await searchParams;
  const locale = await accountLocale(localeParam);
  const t = postOrderCopy(locale).password;
  const app = sanitizeAppReturnUrl(appParam);

  const errorText = error
    ? error === "mismatch"
      ? t.errors.mismatch
      : error === "invalid_or_expired"
        ? t.errors.expired
        : error === "invalid"
          ? t.errors.invalid
          : t.errors.failed
    : null;
  const forgotHref = `/account/forgot?locale=${locale}${app ? `&app=${encodeURIComponent(app)}` : ""}`;

  return (
    <main
      dir={dirFor(locale)}
      className="mx-auto min-h-screen max-w-md bg-cream px-6 py-14 text-ink"
    >
      <p className="text-xs uppercase tracking-[0.28em] rtl:normal-case rtl:tracking-normal text-gold-dark">
        {BRAND.name}
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">{t.resetTitle}</h1>
      <p className="mt-3 text-sm text-muted">{t.resetIntro}</p>

      {errorText ? (
        <p role="alert" className="mt-6 border-s-4 border-red-900 bg-red-900/10 px-4 py-3 text-sm">
          {errorText}
        </p>
      ) : null}

      <form action={resetCustomerPasswordAction} className="mt-6 space-y-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="locale" value={locale} />
        {app ? <input type="hidden" name="app" value={app} /> : null}
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-[0.14em] rtl:normal-case rtl:tracking-normal text-muted">
            {t.newLabel}
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={CUSTOMER_PASSWORD_MIN_LENGTH}
            maxLength={200}
            autoComplete="new-password"
            className="mt-1 block w-full border border-ink/25 bg-white px-3 py-2.5 text-base outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-gold/40"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-[0.14em] rtl:normal-case rtl:tracking-normal text-muted">
            {t.confirmLabel}
          </span>
          <input
            type="password"
            name="confirm"
            required
            minLength={CUSTOMER_PASSWORD_MIN_LENGTH}
            maxLength={200}
            autoComplete="new-password"
            className="mt-1 block w-full border border-ink/25 bg-white px-3 py-2.5 text-base outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-gold/40"
          />
        </label>
        <button
          type="submit"
          className="w-full bg-ink px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] rtl:normal-case rtl:tracking-normal text-card hover:opacity-90"
        >
          {t.save}
        </button>
      </form>

      <p className="mt-8 text-sm">
        <Link href={forgotHref} className="underline underline-offset-2">
          {t.forgotLink}
        </Link>
      </p>
    </main>
  );
}
