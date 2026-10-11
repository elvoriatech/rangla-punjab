/**
 * "Rabatt 10 %" / "Discount 10 %" — the order-wide discount's row label on
 * receipts and the tracking page (owner, 2026-10-11). German for a German
 * guest, English otherwise; the number carries the meaning either way.
 */
const WORD: Record<string, string> = {
  de: "Rabatt",
  en: "Discount",
  fr: "Remise",
  it: "Sconto",
  es: "Descuento",
  ar: "خصم",
};

export function orderDiscountLabel(
  percent: number | null | undefined,
  locale?: string | null,
): string {
  const word = WORD[(locale ?? "de").slice(0, 2)] ?? WORD.en!;
  return `${word} ${percent ?? 0} %`;
}
