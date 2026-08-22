import type { Metadata } from "next";
import { FlashMessage } from "@/components/flash-message";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { resetPasswordAction } from "../actions";

export const metadata: Metadata = {
  title: `Set a new password — ${BRAND.name}`,
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Please choose a password of at least 12 characters.",
  mismatch: "The two passwords didn't match. Please type them again.",
  invalid_or_expired:
    "This reset link has already been used or has expired. Request a new one from the login page.",
};

/**
 * Landing page for the password-reset link. Renders a set-password form
 * (no JS: plain POST server action). The token lives in the path and rides
 * along in a hidden field. On success the action redirects to /login; on
 * failure it bounces back here with a coded error in the query string.
 */
export default async function ResetTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.invalid) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-6 text-ink">
      <div className="w-full max-w-md border border-ink/10 bg-white p-10 shadow-[0_24px_60px_-32px_rgba(28,19,11,0.35)]">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
          <span className="text-xs uppercase tracking-[0.34em] text-gold-dark">{BRAND.name}</span>
        </div>

        <h1 className="mt-6 font-serif text-3xl leading-tight">Set a new password</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Choose a password to finish setting up your account. It needs to be at least 12
          characters.
        </p>

        {errorMessage ? <FlashMessage kind="error" text={errorMessage} /> : null}

        <form action={resetPasswordAction} className="mt-8 flex flex-col gap-5">
          <input type="hidden" name="token" value={token} />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">New password</span>
            <input
              type="password"
              name="password"
              required
              minLength={12}
              maxLength={1024}
              autoComplete="new-password"
              className="border border-ink/25 bg-white px-3.5 py-2.5 text-base outline-none transition-colors focus:border-gold-dark focus:ring-2 focus:ring-gold/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Confirm password</span>
            <input
              type="password"
              name="confirm"
              required
              minLength={12}
              maxLength={1024}
              autoComplete="new-password"
              className="border border-ink/25 bg-white px-3.5 py-2.5 text-base outline-none transition-colors focus:border-gold-dark focus:ring-2 focus:ring-gold/30"
            />
          </label>
          <button
            type="submit"
            className="mt-2 bg-orange px-4 py-3.5 text-sm font-semibold uppercase tracking-[0.18em] text-card shadow-[0_10px_24px_-12px_rgba(194,90,34,0.65)] transition hover:bg-orange-dark active:scale-[0.985]"
          >
            Set password
          </button>
        </form>

        <p className="mt-6 text-xs text-muted">
          Already know your password?{" "}
          <Link href="/login" className="underline underline-offset-2 hover:text-ink">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
