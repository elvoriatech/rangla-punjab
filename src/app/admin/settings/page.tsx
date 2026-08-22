import { notFound, redirect } from "next/navigation";
import { FlashMessage } from "@/components/flash-message";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { getOperatorSettings, EMAIL_TRANSPORTS, APP_THEMES } from "@/lib/operator-settings";
import { env } from "@/lib/env";
import { SubmitButton } from "@/components/submit-button";
import { saveOperatorSettingsAction, savePlatformStripeKeysAction } from "./actions";

/**
 * P3-1 — Operator Console settings. The operator tunes the per-order fee
 * model and flips the public site on/off here; the values are read by
 * connect-service (fee) and the public order/pay routes (kill switch).
 */

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if (!(await isPlatformAdmin(userId))) notFound();

  const { saved } = await searchParams;
  const settings = await getOperatorSettings();
  const resendKeySet = Boolean(env.RESEND_API_KEY);

  const field = "block border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-white";

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="mx-auto max-w-2xl">
        <h1 className="font-serif text-3xl text-white">Settings</h1>
        <p className="mt-1 text-sm text-neutral-400">
          The public site kill switch, theme, and email delivery for this deployment. No commission
          is ever taken — the restaurant keeps 100% of every order.
        </p>
      </header>

      {saved ? <FlashMessage kind="success" text="Saved." /> : null}

      <form action={saveOperatorSettingsAction} className="mx-auto mt-8 max-w-2xl space-y-8">
        <fieldset className="border border-white/10 bg-white/[0.02] p-5">
          <legend className="px-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
            Theme
          </legend>
          <p className="mb-3 text-xs text-neutral-400">
            The look of the admin, dashboard, and owner login. Switching applies everywhere on save
            — no redeploy.
          </p>
          <div className="space-y-2">
            {APP_THEMES.map((t) => (
              <label
                key={t.id}
                className="flex items-start gap-3 border border-white/10 px-3 py-2.5 text-sm text-white has-[:checked]:border-admin-accent/50 has-[:checked]:bg-white/[0.04]"
              >
                <input
                  type="radio"
                  name="appTheme"
                  value={t.id}
                  defaultChecked={settings.appTheme === t.id}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="mt-0.5 block text-xs text-neutral-400">{t.tagline}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="border border-white/10 bg-white/[0.02] p-5">
          <legend className="px-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
            Commission
          </legend>
          <p className="text-sm text-white">
            None — this deployment takes no per-order fee and no subscription.
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            The restaurant connects its own Stripe / PayPal accounts and keeps 100% of every order.
            This is fixed in code (computePlatformFeeCents always returns 0).
          </p>
        </fieldset>

        <fieldset className="border border-white/10 bg-white/[0.02] p-5">
          <legend className="px-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
            Public site
          </legend>
          <label className="flex items-center gap-3 text-sm text-white">
            <input
              type="checkbox"
              name="siteActive"
              defaultChecked={settings.siteActive}
              className="h-4 w-4"
            />
            <span>
              <span className="font-medium">Accept online orders</span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                When off, the menu stays visible but ordering and payment are paused.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="border border-white/10 bg-white/[0.02] p-5">
          <legend className="px-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
            Email delivery
          </legend>
          <p className="mb-4 text-xs text-neutral-400">
            Controls where the app sends invites, password resets, and receipts. Changes take effect
            immediately — no restart. Leave a field on its default to use the value baked into this
            deployment&apos;s environment.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs uppercase tracking-[0.14em] text-neutral-500">
              Transport
              <select
                name="emailTransport"
                defaultValue={settings.emailTransport ?? ""}
                className={`mt-1 w-full ${field}`}
              >
                <option value="">Use env default ({env.EMAIL_TRANSPORT})</option>
                {EMAIL_TRANSPORTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs uppercase tracking-[0.14em] text-neutral-500">
              From address
              <input
                type="text"
                name="emailFrom"
                defaultValue={settings.emailFrom ?? ""}
                placeholder={env.EMAIL_FROM}
                className={`mt-1 w-full ${field}`}
              />
            </label>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-neutral-500">
            <span className="text-neutral-300">mailhog</span> = local dev inbox ·{" "}
            <span className="text-neutral-300">resend</span> = real delivery (production) ·{" "}
            <span className="text-neutral-300">console</span> = log only. Choosing{" "}
            <span className="text-neutral-300">resend</span> requires the{" "}
            <code className="text-neutral-400">RESEND_API_KEY</code> environment variable, which is
            a secret and stays in the environment —{" "}
            {resendKeySet ? (
              <span className="text-emerald-300">currently set ✓</span>
            ) : (
              <span className="text-admin-accent">not set yet ⚠</span>
            )}
            . A verified sending domain on Resend must match the From address.
          </p>
        </fieldset>

        <button
          type="submit"
          className="border border-admin-accent/40 bg-admin-accent/10 px-5 py-2 text-sm font-medium text-admin-accent transition-colors hover:bg-admin-accent/20"
        >
          Save settings
        </button>
      </form>

      <section className="mx-auto mt-8 max-w-2xl border border-admin-line bg-white/[0.02] p-5">
        <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500">
          Payment keys (Stripe)
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
          The platform Stripe keys that charge guests and take your fee. Stored{" "}
          <span className="text-neutral-300">encrypted</span> — change them here any time, no
          redeploy. Enter a value to set or replace it; leave a field blank to keep the current one.
          Keys are never shown again — only a masked hint.
        </p>
        <form action={savePlatformStripeKeysAction} className="mt-4 space-y-4">
          {[
            { name: "stripeSecret", label: "Secret key (sk_…)", mask: settings.stripeSecretMask },
            {
              name: "stripeWebhook",
              label: "Webhook signing secret (whsec_…)",
              mask: settings.stripeWebhookMask,
            },
            {
              name: "stripeConnectWebhook",
              label: "Connect webhook secret (whsec_…)",
              mask: settings.stripeConnectWebhookMask,
            },
          ].map((f) => (
            <label
              key={f.name}
              className="block text-xs uppercase tracking-[0.14em] text-neutral-500"
            >
              {f.label}
              <span className="ml-2 normal-case tracking-normal text-neutral-400">
                {f.mask ? `— current: ${f.mask}` : "— not set (using env)"}
              </span>
              <input
                type="password"
                name={f.name}
                autoComplete="off"
                placeholder="Leave blank to keep current"
                className={`mt-1 w-full ${field}`}
              />
            </label>
          ))}
          <SubmitButton
            pendingLabel="Saving…"
            className="border border-admin-accent/40 bg-admin-accent/10 px-5 py-2 text-sm font-medium text-admin-accent hover:bg-admin-accent/20 disabled:opacity-70"
          >
            Save payment keys
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
