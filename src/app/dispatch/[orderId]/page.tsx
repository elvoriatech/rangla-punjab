import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDispatchOrder } from "@/lib/dispatch-service";
import { verifyDispatchToken } from "@/lib/dispatch-token";
import { dispatchAction } from "./actions";

/**
 * The page a driver lands on after scanning a delivery ticket's QR.
 *
 * Design constraints, in order of how much they mattered:
 *  1. It is used one-handed, outdoors, possibly in the rain. One screen,
 *     one enormous button, no scrolling to reach it.
 *  2. It must work with no JavaScript — a form POST to a server action.
 *     The auto-forward to Maps is a `<meta http-equiv="refresh">`, not a
 *     script, so it survives a browser that never runs our bundle.
 *  3. The token is the whole credential (see `dispatch-token.ts`): no
 *     login, because a driver carrying two bags cannot type a password.
 *
 * Not localised, and that is deliberate: this surface is for the
 * restaurant's own drivers, the ticket it is printed on is already
 * bilingual German/English, and every other word on screen is the
 * guest's name and address.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Delivery",
  // A bearer link. It must never be indexed, and there is nothing here
  // worth a preview card in a messaging app either.
  robots: { index: false, follow: false },
};

/** Plain-language reasons, so a driver knows whether to fetch a manager
 *  or simply drive. */
const ERRORS: Record<string, string> = {
  invalid: "This link is no longer valid. Ask the kitchen to reprint the ticket.",
  not_found: "We can't find that order any more.",
  not_delivery: "That order isn't a delivery — nothing to dispatch.",
  wrong_state: "The kitchen hasn't marked this order ready yet.",
  busy: "Too many taps at once. Give it a moment and try again.",
};

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ t?: string; e?: string; sent?: string }>;
}): Promise<React.ReactElement> {
  const { orderId } = await params;
  const { t, e } = await searchParams;

  const verified = t ? verifyDispatchToken(t) : null;
  if (!verified || verified.orderId !== orderId) notFound();

  const result = await getDispatchOrder(verified.tenantId, orderId);
  if (!result.ok && result.error === "not_found") notFound();

  const error = e ? (ERRORS[e] ?? ERRORS.invalid) : !result.ok ? ERRORS[result.error] : null;
  const order = result.ok ? result : null;
  const out = order?.already ?? false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 bg-cream px-5 py-10 text-ink">
      {/* NO auto-forward to Maps here, deliberately.
          The first cut used `<meta http-equiv="refresh" content="2;…">`
          so the phone handed over to navigation on its own. axe flags
          that as a CRITICAL failure of WCAG 2.2.1 (Timing Adjustable),
          and rightly: a timed jump with no way to stop it yanks the page
          out from under anyone who reads slowly, uses a screen reader,
          or simply wanted to check the address twice — and with no
          JavaScript there is no way to offer them a cancel.
          "Open route" below is one deliberate tap instead, which also
          lets the driver finish loading the car before navigation
          starts. WCAG 2.1 AA is non-negotiable here (CLAUDE.md); a
          convenience that costs a conformance failure is not a trade. */}
      <header className="text-center">
        {/* `text-muted`, not the house eyebrow's `text-gold-dark`: gold on
            cream is 3.78:1, which fails AA for 12px text. `--rp-muted` is
            the token the design system already darkened for exactly this
            (see globals.css). A driver reads this in daylight, on a
            phone, at arm's length — the one place to spend legibility on. */}
        <p className="text-xs uppercase tracking-[0.28em] text-muted">Delivery</p>
        <h1 className="mt-1 font-serif text-4xl leading-tight">
          {order ? `Order #${String(order.orderNumber).padStart(4, "0")}` : "Delivery"}
        </h1>
      </header>

      {error ? (
        <p
          role="alert"
          className="border border-red-800/30 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {error}
        </p>
      ) : null}

      {order ? (
        <section className="border border-ink/15 bg-card px-5 py-4" aria-label="Delivery details">
          {order.customerName ? <p className="text-lg font-medium">{order.customerName}</p> : null}
          {order.addressLine ? (
            <p className="mt-1 text-base leading-snug text-ink/80">{order.addressLine}</p>
          ) : (
            <p className="mt-1 text-sm text-muted">No address on this order.</p>
          )}
        </section>
      ) : null}

      {order && !out ? (
        <form action={dispatchAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="token" value={t} />
          {/* Deliberately huge: a gloved thumb, at arm's length. */}
          <button
            type="submit"
            className="w-full bg-orange px-6 py-6 text-lg font-medium uppercase tracking-[0.14em] text-card hover:bg-orange-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Out for delivery ✓
          </button>
        </form>
      ) : null}

      {out ? (
        <div className="text-center">
          <p className="text-lg font-medium">On the way — the guest has been told.</p>
          {order?.directionsUrl ? (
            <>
              <a
                href={order.directionsUrl}
                className="mt-4 block w-full bg-ink px-6 py-5 text-base font-medium uppercase tracking-[0.14em] text-card hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                Open route
              </a>
            </>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
