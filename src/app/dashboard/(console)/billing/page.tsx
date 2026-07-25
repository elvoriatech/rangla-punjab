import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { asUser } from "@/lib/tenant";
import { SUPPORT_PLAN } from "@/lib/plans";
import { getConnectStatus, refreshConnectStatus } from "@/lib/connect-service";
import { getStripeProvider } from "@/lib/stripe";
import { getOperatorSettings } from "@/lib/operator-settings";
import { getOwnKeysStatus } from "@/lib/tenant-payment-keys";
import { SubmitButton } from "@/components/submit-button";
import {
  checkPaymentsAction,
  openBillingPortalAction,
  saveOwnKeysAction,
  setupPaymentsAction,
  subscribeToSupportAction,
} from "./actions";

/**
 * `/dashboard/billing` — one page: the monthly support subscription (pay
 * the operator's flat hosting/support fee) and online-payment payouts
 * (Stripe Connect, so guests can pay by card). Server component + server
 * actions; no client JS.
 *
 * An overdue support payment is shown as a WARNING only — the public menu
 * and ordering stay live regardless (gating lives in plan-state.ts, which
 * never consults billing).
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    connect?: string;
    error?: string;
    ok?: string;
    cancelled?: string;
    ownkeys?: string;
  }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const { connect, error, ok, ownkeys } = await searchParams;
  // Payout method follows the operator's fee mode: upfront/flat plan ⇒ the
  // restaurant charges with their OWN keys (keeps 100%); percentage/commission
  // ⇒ Stripe Connect (operator auto-takes the fee).
  const { feeMode } = await getOperatorSettings();
  const ownKeysMode = feeMode === "upfront";
  const ownKeys = ownKeysMode ? await getOwnKeysStatus(userId) : null;
  // Bounce-back from onboarding: refresh the charges-enabled mirror
  // before rendering (real Stripe also pushes account.updated webhooks).
  if (connect === "done") await refreshConnectStatus(userId);
  const connectStatus = await getConnectStatus(userId);
  // Demo vs real Stripe: the fake provider never charges a real card, so an
  // owner testing on a not-yet-live deployment should be told so plainly.
  const isDemo = (await getStripeProvider()).mode === "fake";
  const connected = Boolean(connectStatus?.accountId);
  const active = Boolean(connectStatus?.chargesEnabled);

  const sub = await asUser(userId, (tx) =>
    tx.subscription.findFirst({ where: { deletedAt: null } }),
  );

  const status = sub?.status ?? null;
  const hasCustomer = Boolean(sub?.stripeCustomerId);
  const isActive = status === "active" || status === "trialing";
  const isOverdue = status === "past_due" || status === "unpaid" || status === "grace";
  const notSubscribed = !sub || status === "incomplete" || status === "canceled";
  const priceEuro = Math.round(SUPPORT_PLAN.priceMonthlyCents / 100);

  const dateFmt = (d: Date | string): string =>
    new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-brand-cream px-6 py-16 text-brand-green">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-brand-gold">Billing</p>
      <h1 className="font-serif text-4xl leading-tight">Plan &amp; billing</h1>
      <p className="mt-2 text-sm text-brand-green/70">
        Your monthly support &amp; hosting subscription and your online-payment payouts.
      </p>

      {ok === "1" ? (
        <p
          role="status"
          className="mt-6 border-l-4 border-[#3f7030] bg-[#f0f6ec] px-4 py-3 text-sm text-[#2f5a24]"
        >
          Subscription updated — thank you!
        </p>
      ) : null}

      <section
        aria-label="Support subscription"
        className="mt-8 border border-brand-green/20 bg-white p-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">{SUPPORT_PLAN.label}</h2>
          <p className="text-sm">
            <span className="font-serif text-2xl" style={{ color: "#1f3b2e" }}>
              €{priceEuro}
            </span>
            <span className="text-xs text-brand-green/60"> /month</span>
          </p>
        </div>

        {isOverdue ? (
          <p
            role="alert"
            className="mt-4 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            Your support payment is <span className="font-semibold">overdue</span>. Please update
            your card to keep your subscription active. Your menu and ordering stay online.
          </p>
        ) : null}

        {sub ? (
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-brand-green/60">Status</dt>
            <dd className="font-medium">{status}</dd>
            {sub.currentPeriodEnd ? (
              <>
                <dt className="text-brand-green/60">
                  {status === "canceled" ? "Access until" : "Next renewal"}
                </dt>
                <dd>{dateFmt(sub.currentPeriodEnd)}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <ul className="mt-4 space-y-1 text-xs text-brand-green/75">
            {SUPPORT_PLAN.features.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {notSubscribed ? (
            <form action={subscribeToSupportAction}>
              <button
                type="submit"
                className="bg-brand-green px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-brand-cream hover:bg-brand-green-dark"
              >
                {isActive ? "Resubscribe" : "Start subscription"} ↗
              </button>
            </form>
          ) : null}
          {hasCustomer ? (
            <form action={openBillingPortalAction}>
              <button
                type="submit"
                className="border border-brand-green px-5 py-2 text-xs font-medium uppercase tracking-wider text-brand-green hover:bg-brand-green hover:text-brand-cream"
              >
                Manage billing ↗
              </button>
            </form>
          ) : null}
        </div>
        {error === "checkout_failed" || error === "no_customer" ? (
          <p role="alert" className="mt-4 text-sm text-red-800">
            Something went wrong opening Stripe — please try again.
          </p>
        ) : null}
      </section>

      <section
        aria-label="Online payments"
        className="mt-10 border border-brand-green/20 bg-white p-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">Online payments</h2>
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
              On your plan you collect payments with <span className="font-medium">your own</span>{" "}
              Stripe account — money settles straight to you and you keep 100%. The operator bills
              the flat monthly fee separately. Paste your keys, enable, and save. Keys are stored
              encrypted and shown only masked.
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
                through Stripe; the operator fee configured for your account is deducted
                automatically per online order. To test end to end, place an order and pay
                {isDemo
                  ? " (demo mode simulates the charge)"
                  : " with a Stripe test card (4242 4242 4242 4242)"}
                .
              </p>
            ) : (
              <p className="mt-3 text-sm text-brand-green/70">
                Let guests pay by card, Apple Pay, or Google Pay when they order. Stripe collects
                your payout details once (bank account, a few identity questions) — about five
                minutes. Payments settle straight to your bank; the operator fee configured for your
                account is deducted per online order.
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
    </main>
  );
}
