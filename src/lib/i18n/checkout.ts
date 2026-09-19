import type { UiLocale } from "@/lib/locales";
import { uiLocale } from "@/lib/locales";
import en, { type CheckoutCopy } from "./checkout/en";
import de from "./checkout/de";
import es from "./checkout/es";
import it from "./checkout/it";
import ar from "./checkout/ar";

/**
 * Guest copy for everything from "open the cart" to "order placed": the
 * cart drawer and the Add button on every dish card.
 *
 * The WORDS live one file per locale under `./checkout/` (P7-16) — this
 * module is the SERVER-side view of them: it imports all five statically
 * so a server component can resolve copy synchronously and pass the
 * strings it needs down as props.
 *
 * ⚠ Client components must NOT import this module: doing so ships all
 * five languages to every guest. Either take the handful of strings you
 * need as a serialisable prop from your server parent, or — if you truly
 * need the whole catalogue — use `./checkout/load.ts`, which pulls one
 * locale on its own chunk. `scripts/check-guest-bundle.ts` fails the
 * build if a foreign locale turns up in the guest chunks.
 *
 * Money is always pre-formatted by the caller (`formatCents`), so these
 * strings never see cents or a currency code.
 */

export type { CheckoutCopy };

export const CHECKOUT_COPY: Record<UiLocale, CheckoutCopy> = { en, de, es, it, ar };

/** Checkout copy for a venue/route locale. Region tags collapse ("de-DE"
 *  → "de"); anything without a catalogue falls back to English. */
export const checkoutCopy = (locale?: string | null): CheckoutCopy =>
  CHECKOUT_COPY[uiLocale(locale)];
