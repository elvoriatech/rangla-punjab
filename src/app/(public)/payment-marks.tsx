import { siApplepay, siGooglepay } from "simple-icons";
import { PAYMENT_METHODS, type PaymentMethodId } from "@/lib/ordering-config";

/**
 * "Accepted payments" strip — the row of brand marks a guest scans before
 * they trust the Pay button.
 *
 * Two sources feed it:
 *   1. What the OWNER ticked in settings (`acceptedPayments`) — how you can
 *      pay on site: cash, Girocard, the cards their terminal takes.
 *   2. What the PLATFORM can actually charge online: when Stripe is live for
 *      the venue every Stripe account processes Visa / Mastercard / Amex, so
 *      those are implied and shown even if the owner never ticked them.
 *      PayPal joins only when the PayPal rail is switched on.
 *
 * Brand marks are the official artwork served as static SVG from
 * /brand/pay/*.svg — no HTML weight on the zero-JS critical path, one
 * cached file per brand across every menu. They sit on a white chip
 * because that is how card networks require their marks to be shown, and
 * it is the one background that holds on every menu theme, light or dark.
 */

/** Card networks a live Stripe account charges without extra setup. */
export const STRIPE_CARD_BRANDS: readonly PaymentMethodId[] = ["visa", "mastercard", "amex"];

const REGISTRY_ORDER = PAYMENT_METHODS.map((m) => m.id) as readonly PaymentMethodId[];
const LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.id, m.label]),
);

/** Official artwork (full colour), per brand, with its own cap height —
 *  a square Amex box and a wide Visa wordmark must not render at the same
 *  height or the row looks broken. */
const BRAND_ART: Record<string, { src: string; className: string }> = {
  visa: { src: "/brand/pay/visa.svg", className: "h-[13px] w-auto" },
  mastercard: { src: "/brand/pay/mastercard.svg", className: "h-5 w-auto" },
  amex: { src: "/brand/pay/amex.svg", className: "h-[22px] w-auto" },
  paypal: { src: "/brand/pay/paypal.svg", className: "h-[13px] w-auto" },
};

/** Wallets ship as Simple Icons glyphs in their brand colour — there is no
 *  full-colour mark for either (both are monochrome by their guidelines). */
const GLYPH_ART: Record<string, { path: string; color: string }> = {
  apple_pay: { path: siApplepay.path, color: "#000000" },
  google_pay: { path: siGooglepay.path, color: "#5F6368" },
};

const EMOJI_ART: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.filter((m) => m.emoji).map((m) => [m.id, m.emoji]),
);

/**
 * Owner-ticked methods ∪ what the enabled online rails can charge, in the
 * registry's order so the strip never reshuffles between renders.
 */
export function acceptedPaymentIds({
  accepted = [],
  onlinePayment = false,
  paypalPayment = false,
}: {
  accepted?: readonly PaymentMethodId[];
  onlinePayment?: boolean;
  paypalPayment?: boolean;
}): PaymentMethodId[] {
  const ids = new Set<PaymentMethodId>(accepted);
  if (onlinePayment) for (const id of STRIPE_CARD_BRANDS) ids.add(id);
  if (paypalPayment) ids.add("paypal");
  return REGISTRY_ORDER.filter((id) => ids.has(id));
}

export function PaymentMarks({
  ids,
  className = "",
}: {
  ids: readonly PaymentMethodId[];
  className?: string;
}): React.ReactElement | null {
  if (ids.length === 0) return null;
  return (
    /* A <div> of role="img" spans, not a <ul>: role="img" on an <li>
       strips its listitem role, which trips axe's `list` rule (P1-25). */
    <div className={"flex flex-wrap items-center gap-1.5 " + className}>
      {ids.map((id) => {
        const art = BRAND_ART[id];
        const glyph = GLYPH_ART[id];
        const emoji = EMOJI_ART[id];
        if (!art && !glyph && !emoji) return null;
        const label = LABELS[id] ?? id;
        return (
          <span
            key={id}
            role="img"
            aria-label={label}
            title={label}
            /* White chip + hairline: card-network artwork must sit on a
               light ground, and white is the only one that reads on both
               a cream and a near-black menu theme. */
            className="flex h-8 min-w-[46px] items-center justify-center rounded-md bg-white px-2 ring-1 ring-black/10"
          >
            {art ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={art.src} alt="" loading="lazy" decoding="async" className={art.className} />
            ) : glyph ? (
              <svg viewBox="0 0 24 24" className="h-4 w-auto" fill={glyph.color} aria-hidden="true">
                <path d={glyph.path} />
              </svg>
            ) : (
              <span aria-hidden="true" className="text-lg leading-none">
                {emoji}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
