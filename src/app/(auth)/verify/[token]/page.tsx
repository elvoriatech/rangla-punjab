import type { Metadata } from "next";
import Link from "next/link";
import { consumeEmailVerification } from "@/lib/verification-service";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Email verification — ${BRAND.name}`,
};

/**
 * The landing page for the verification link. Consumes the single-use
 * token server-side and tells the owner what happened in words, not
 * JSON. A reused link shows the "already used or expired" state — with
 * a Continue button anyway, because the most common cause is clicking
 * the same link twice after already being verified.
 */
export default async function VerifyTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const result =
    token.length >= 10 && token.length <= 512
      ? await consumeEmailVerification(token)
      : ({ ok: false } as const);

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-6 text-ink">
      <div className="w-full max-w-md border border-ink/10 bg-white p-10 text-center shadow-[0_24px_60px_-32px_rgba(28,19,11,0.35)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-192.png" alt="" className="mx-auto h-12 w-12 rounded-xl" />
        {result.ok ? (
          <>
            <h1 className="mt-6 font-serif text-3xl leading-tight">Email confirmed ✓</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Your account is fully set up. Password recovery and order notifications will reach you
              at this address.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-6 font-serif text-3xl leading-tight">
              This link has already been used or expired
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              If you already clicked it once, you&apos;re verified — just continue. Otherwise log in
              and use <span className="font-medium">Resend the email</span> in the dashboard banner.
            </p>
          </>
        )}
        <Link
          href="/dashboard"
          className="mt-8 inline-block bg-orange px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-card shadow-[0_10px_24px_-12px_rgba(194,90,34,0.65)] transition hover:bg-orange-dark"
        >
          Continue to your dashboard
        </Link>
        <p className="mt-4 text-xs text-muted">
          Not signed in on this device?{" "}
          <Link href="/login" className="underline underline-offset-2">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
