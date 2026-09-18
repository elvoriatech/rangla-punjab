/**
 * German gross pricing: every price on the menu already INCLUDES VAT, so
 * the receipt shows the tax contained in the total rather than adding
 * any on top. One statutory rate, computed in one place. Dependency-free
 * so the cart (client) and the PDF/email (server) share the same maths.
 */
export const VAT_RATE_BPS = 1900;

/** VAT contained in a gross amount at the statutory rate. */
export function vatFromGross(grossCents: number): number {
  const net = Math.round((grossCents * 10_000) / (10_000 + VAT_RATE_BPS));
  return grossCents - net;
}

/** "19" for labels — derived so the rate never drifts from the maths. */
export const VAT_RATE_LABEL = String(VAT_RATE_BPS / 100);
