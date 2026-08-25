import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getConnectStatus, refreshConnectStatus } from "@/lib/connect-service";
import { getStripeProvider } from "@/lib/stripe";
import { siteUrl } from "@/lib/site-url";
import { getOperatorSettings } from "@/lib/operator-settings";
import { getOwnKeysStatus, getPayPalKeysStatus } from "@/lib/tenant-payment-keys";
import { SubmitButton } from "@/components/submit-button";
import {
  checkPaymentsAction,
  saveOwnKeysAction,
  savePayPalKeysAction,
  setupPaymentsAction,
} from "./actions";

/**
 * `/dashboard/billing` — online-payment payouts (Stripe Connect or
 * own-keys mode, so guests can pay by card). Server component + server
 * actions; no client JS.
 *
 * This deployment is a single-restaurant install where the owner IS the
 * operator, so the SaaS-era "support & hosting subscription" card is
 * gone — there is nobody to bill a monthly fee to. The billing service
 * and its actions still exist for a future multi-tenant setup; only the
 * surface is hidden. The route keeps its /dashboard/billing URL because
 * Stripe return URLs and emails link to it.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    connect?: string;
    error?: string;
    ownkeys?: string;
    paypal?: string;
  }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const { connect, error, ownkeys, paypal } = await searchParams;
  // Payout method follows the operator's fee mode: upfront/flat plan ⇒ the
  // restaurant charges with their OWN keys (keeps 100%); percentage/commission
  // ⇒ Stripe Connect (operator auto-takes the fee).
  const { feeMode } = await getOperatorSettings();
  const ownKeysMode = feeMode === "upfront";
  const ownKeys = ownKeysMode ? await getOwnKeysStatus(userId) : null;
  const payPal = await getPayPalKeysStatus(userId);
  // Bounce-back from onboarding: refresh the charges-enabled mirror
  // before rendering (real Stripe also pushes account.updated webhooks).
  if (connect === "done") await refreshConnectStatus(userId);
  const connectStatus = await getConnectStatus(userId);
  // Demo vs real Stripe: the fake provider never charges a real card, so an
  // owner testing on a not-yet-live deployment should be told so plainly.
  const isDemo = (await getStripeProvider()).mode === "fake";
  const connected = Boolean(connectStatus?.accountId);
  const active = Boolean(connectStatus?.chargesEnabled);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-brand-cream px-6 py-16 text-brand-green">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-brand-gold">Payments</p>
      <h1 className="font-serif text-4xl leading-tight">Online payments</h1>
      <p className="mt-2 text-sm text-brand-green/70">
        Let guests pay by card or PayPal when they order — payouts settle straight to your bank.
      </p>

      <section
        aria-label="Online payments"
        className="mt-8 border border-brand-green/20 bg-white p-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">Card payments via Stripe</h2>
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${
              (ownKeysMode ? ownKeys?.enabled && ownKeys.hasSecret : active)
                ? "text-[#3f7030]"
                : (ownKeysMode ? ownKeys?.hasSecret : connected)
                  ? "text-amber-700"
                  : "text-brand-green/40"
            }`}
          >
            {ownKeysMode
              ? ownKeys?.enabled && ownKeys.hasSecret
                ? "● On"
                : ownKeys?.hasSecret
                  ? "◐ Keys saved · off"
                  : "○ Not set up"
              : active
                ? "● Active"
                : connected
                  ? "◐ Setup incomplete"
                  : "○ Not set up"}
          </span>
        </div>

        {ownkeys === "saved" ? (
          <p
            role="status"
            className="mt-3 border-l-4 border-[#3f7030] bg-[#f0f6ec] px-4 py-2 text-sm text-[#2f5a24]"
          >
            Payment keys saved.
          </p>
        ) : null}

        {ownKeysMode ? (
          <>
            <p className="mt-3 text-sm text-brand-green/70">
              You collect payments with <span className="font-medium">your own</span> Stripe account
              — money settles straight to your bank and you keep 100%. Paste your keys, enable, and
              save. Keys are stored encrypted and shown only masked.
            </p>
            <form action={saveOwnKeysAction} className="mt-4 space-y-4">
              <label className="block text-xs uppercase tracking-[0.14em] text-brand-green/60">
                Secret key (sk_…)
                <span className="ml-2 normal-case tracking-normal text-brand-green/50">
                  {ownKeys?.secretMask ? `— current: ${ownKeys.secretMask}` : "— not set"}
                </span>
                <input
                  type="password"
                  name="ownSecret"
                  autoComplete="off"
                  placeholder="Leave blank to keep current"
                  className="mt-1 block w-full border border-brand-green/25 bg-white px-3 py-2 text-sm text-brand-green outline-none focus:border-brand-green"
                />
              </label>
              <label className="block text-xs uppercase tracking-[0.14em] text-brand-green/60">
                Webhook signing secret (whsec_…)
                <span className="ml-2 normal-case tracking-normal text-brand-green/50">
                  {ownKeys?.webhookMask ? `— current: ${ownKeys.webhookMask}` : "— not set"}
                </span>
                <input
                  type="password"
                  name="ownWebhook"
                  autoComplete="off"
                  placeholder="Leave blank to keep current"
                  className="mt-1 block w-full border border-brand-green/25 bg-white px-3 py-2 text-sm text-brand-green outline-none focus:border-brand-green"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-brand-green">
                <input
                  type="checkbox"
                  name="ownEnabled"
                  defaultChecked={ownKeys?.enabled}
                  className="h-4 w-4"
                />
                Enable — accept online payments with these keys
              </label>
              <SubmitButton
                pendingLabel="Saving…"
                className="bg-brand-green px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-brand-cream hover:bg-brand-green-dark disabled:opacity-70"
              >
                Save payment keys
              </SubmitButton>
            </form>
          </>
        ) : null}

        {!ownKeysMode ? (
          <>
            {isDemo ? (
              <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                <span className="font-semibold">Demo mode</span> — this deployment has no live
                Stripe keys yet, so no real cards are charged. You can still connect and test the
                flow; ask the operator to add live keys to go live.
              </p>
            ) : null}

            {connect === "checked" ? (
              <p
                role="status"
                className={`mt-3 border-l-4 px-4 py-2 text-sm ${
                  active
                    ? "border-[#3f7030] bg-[#f0f6ec] text-[#2f5a24]"
                    : "border-amber-500 bg-amber-50 text-amber-900"
                }`}
              >
                {active
                  ? "Connection checked — you're ready to accept online payments."
                  : "Checked — Stripe hasn't enabled charges yet. Finish the remaining steps on Stripe, then check again."}
              </p>
            ) : null}
            {error === "payments" ? (
              <p
                role="alert"
                className="mt-3 border-l-4 border-red-800/60 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                Couldn&apos;t start the payout setup — try again.
              </p>
            ) : null}

            {active ? (
              <p className="mt-3 text-sm text-brand-green/70">
                Guests can pay online at checkout. Money settles directly to your bank account
                through Stripe — you keep 100% of every order, there is no commission. To test end
                to end, place an order and pay
                {isDemo
                  ? " (demo mode simulates the charge)"
                  : " with a Stripe test card (4242 4242 4242 4242)"}
                .
              </p>
            ) : (
              <p className="mt-3 text-sm text-brand-green/70">
                Let guests pay by card, Apple Pay, or Google Pay when they order. Stripe collects
                your payout details once (bank account, a few identity questions) — about five
                minutes. Payments settle straight to your bank — you keep 100% of every order, there
                is no commission and no subscription.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              {!active ? (
                <form action={setupPaymentsAction}>
                  <button
                    type="submit"
                    className="bg-brand-green px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-brand-cream hover:bg-brand-green-dark"
                  >
                    {connected ? "Finish setup on Stripe ↗" : "Set up payouts with Stripe ↗"}
                  </button>
                </form>
              ) : null}
              {connected ? (
                <form action={checkPaymentsAction}>
                  <button
                    type="submit"
                    className="border border-brand-green px-5 py-2 text-xs font-medium uppercase tracking-wider text-brand-green hover:bg-brand-green hover:text-brand-cream"
                  >
                    Check connection
                  </button>
                </form>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      {/* PayPal — the same own-credentials posture as Stripe above, so a
          restaurant can run either rail (or both) without a deploy. */}
      <section
        aria-label="PayPal payments"
        className="mt-10 border border-brand-green/20 bg-white p-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">PayPal</h2>
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${
              payPal.enabled && payPal.hasCredentials
                ? "text-[#3f7030]"
                : payPal.hasCredentials
                  ? "text-amber-700"
                  : "text-brand-green/40"
            }`}
          >
            {payPal.enabled && payPal.hasCredentials
              ? `● On · ${payPal.env}`
              : payPal.hasCredentials
                ? "◐ Keys saved · off"
                : "○ Not set up"}
          </span>
        </div>

        {paypal === "saved" ? (
          <p
            role="status"
            className="mt-3 border-l-4 border-[#3f7030] bg-[#f0f6ec] px-4 py-2 text-sm text-[#2f5a24]"
          >
            PayPal settings saved.
          </p>
        ) : null}

        <p className="mt-3 text-sm text-brand-green/70">
          Guests pay with their PayPal balance or card, straight into{" "}
          <span className="font-medium">your</span> PayPal business account. Create a REST app at{" "}
          <span className="font-medium">developer.paypal.com → Apps &amp; Credentials</span> and
          paste its Client ID and Secret. Start in <span className="font-medium">Sandbox</span> to
          test, then switch to Live. Credentials are stored encrypted and shown only masked.
        </p>

        <form action={savePayPalKeysAction} className="mt-4 space-y-4">
          <label className="block text-xs uppercase tracking-[0.14em] text-brand-green/60">
            Client ID
            <span className="ml-2 normal-case tracking-normal text-brand-green/50">
              {payPal.clientIdMask ? `— current: ${payPal.clientIdMask}` : "— not set"}
            </span>
            <input
              type="password"
              name="paypalClientId"
              autoComplete="off"
              placeholder="Leave blank to keep current"
              className={
                "mt-1 block w-full border border-brand-green/25 bg-white px-3 py-2 text-sm text-brand-green outline-none focus:border-brand-green"
              }
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.14em] text-brand-green/60">
            Secret
            <span className="ml-2 normal-case tracking-normal text-brand-green/50">
              {payPal.secretMask ? `— current: ${payPal.secretMask}` : "— not set"}
            </span>
            <input
              type="password"
              name="paypalSecret"
              autoComplete="off"
              placeholder="Leave blank to keep current"
              className={
                "mt-1 block w-full border border-brand-green/25 bg-white px-3 py-2 text-sm text-brand-green outline-none focus:border-brand-green"
              }
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.14em] text-brand-green/60">
            Environment
            <select
              name="paypalEnv"
              defaultValue={payPal.env}
              className={
                "mt-1 block w-full border border-brand-green/25 bg-white px-3 py-2 text-sm text-brand-green outline-none focus:border-brand-green"
              }
            >
              <option value="sandbox">Sandbox (testing — no real money)</option>
              <option value="live">Live (real payments)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-green">
            <input
              type="checkbox"
              name="paypalEnabled"
              defaultChecked={payPal.enabled}
              className="h-4 w-4"
            />
            Enable — offer PayPal to guests at checkout
          </label>
          <p className="text-xs text-brand-green/60">
            Webhook URL for your PayPal app (optional — capture is confirmed inline):{" "}
            <code className="text-brand-green">{`${siteUrl()}/api/paypal/return`}</code>
          </p>
          <SubmitButton
            pendingLabel="Saving…"
            className="bg-brand-green px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-brand-cream hover:bg-brand-green-dark disabled:opacity-70"
          >
            Save PayPal settings
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
