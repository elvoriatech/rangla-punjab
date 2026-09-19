import type { Metadata } from "next";
import Link from "next/link";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { BRAND } from "@/lib/brand";
import { postOrderCopy } from "@/lib/i18n/post-order";
import { dirFor } from "@/lib/locales";
import { accountLocale } from "../locale";
import { requestCustomerResetAction } from "./actions";
import { RequiredLegend, RequiredMark } from "@/components/required-mark";

/**
 * "Forgot your password?" — one email field and a server action. No
 * client JS anywhere on this page: the form posts, the action redirects
 * back here with `?sent=1`, and the confirmation is plain server-rendered
 * text with `role="status"` so a screen reader announces it.
 *
 * The confirmation is deliberately the SAME for every address, known or
 * not (see the action), which is also why the form stays on the page
 * afterwards: a guest who mistyped their address can simply try again.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `Passwort vergessen · ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; locale?: string; app?: string }>;
}): Promise<React.ReactElement> {
  const { sent, error, locale: localeParam, app: appParam } = await searchParams;
  const locale = await accountLocale(localeParam);
  const copy = postOrderCopy(locale);
  const t = copy.password;
  const app = sanitizeAppReturnUrl(appParam);
  const errorText = error ? (error === "invalid" ? t.errors.invalid : t.errors.failed) : null;
  const accountHref = `/account?locale=${locale}${app ? `&app=${encodeURIComponent(app)}` : ""}`;

  return (
    <main
      dir={dirFor(locale)}
      className="mx-auto min-h-screen max-w-md bg-cream px-6 py-14 text-ink"
    >
      <p className="text-xs uppercase tracking-[0.28em] rtl:normal-case rtl:tracking-normal text-gold-dark">
        {BRAND.name}
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">{t.forgotTitle}</h1>
      <p className="mt-3 text-sm text-muted">{t.forgotIntro}</p>

      {sent ? (
        <p
          role="status"
          className="mt-6 border-s-4 border-[#3f7030] bg-[#3f7030]/10 px-4 py-3 text-sm"
        >
          {t.sent}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="mt-6 border-s-4 border-red-900 bg-red-900/10 px-4 py-3 text-sm">
          {errorText}
        </p>
      ) : null}

      <form action={requestCustomerResetAction} className="mt-6 space-y-4">
        <input type="hidden" name="locale" value={locale} />
        {app ? <input type="hidden" name="app" value={app} /> : null}
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-[0.14em] rtl:normal-case rtl:tracking-normal text-muted">
            {t.emailLabel}
            <RequiredMark label={copy.required.mark} />
          </span>
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            className="mt-1 block w-full border border-ink/25 bg-white px-3 py-2.5 text-base outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-gold/40"
          />
        </label>
        <RequiredLegend label={copy.required.legend} className="text-xs text-muted" />
        <button
          type="submit"
          className="w-full bg-ink px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] rtl:normal-case rtl:tracking-normal text-card hover:opacity-90"
        >
          {t.sendLink}
        </button>
      </form>

      <p className="mt-8 text-sm">
        <Link href={accountHref} className="underline underline-offset-2">
          {t.backToSignIn}
        </Link>
      </p>
    </main>
  );
}
