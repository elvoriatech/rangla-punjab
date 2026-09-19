import type { UiLocale } from "@/lib/locales";
import { uiLocale } from "@/lib/locales";
import { VAT_RATE_LABEL } from "@/lib/vat";

/**
 * Receipt-PDF copy. Two constraints the other catalogues don't have, both
 * imposed by `pdf-lib`'s standard Courier face:
 *
 *  1. WinAnsi (CP1252) only. Anything outside it is silently stripped by
 *     `safe()` in `receipt-pdf.ts`, so every string here stays inside
 *     Latin-1 — plain ASCII apostrophes, no typographic dashes, no emoji.
 *  2. Fixed width. `label` values print in a column `LABEL_CHARS` wide
 *     (10 characters); `unpaid`/`paid`/`vatNote` lines are centred without
 *     wrapping, so each one stays under ~38 characters.
 *
 * Plan decision 4: Arabic is deliberately NOT translated here. StandardFonts
 * cannot encode Arabic script at all — a translated PDF would come out with
 * the labels blanked rather than merely in the wrong language — so `ar`
 * maps to the English catalogue, and `pdfLocale()` below makes the number
 * and date formats follow suit. Arabic dish NAMES have the same limitation
 * and are out of scope; the HTML receipt email is the Arabic-safe artefact.
 */

const en = {
  type: "Type",
  delivery: "Delivery",
  pickup: "Pickup",
  planned: "Planned",
  name: "Name",
  phone: "Phone",
  address: "Address",
  note: "Note",
  table: "Table",
  order: "Order #",
  paidOnline: "PAID ONLINE",
  paidReward: "PAID WITH REWARD",
  reward: "Reward",
  net: "Net",
  vat: `VAT ${VAT_RATE_LABEL}% (incl.)`,
  total: "TOTAL",
  vatNote: `Total includes ${VAT_RATE_LABEL}% VAT.`,
  unpaid: ["Payment is settled at the", "restaurant - this is not", "a tax invoice."],
  paid: ["Paid online - thank you."],
  paidWithReward: ["Paid with your reward -", "enjoy your meal."],
  thanks: "Thank you & see you soon!",
};

export type PdfCopy = typeof en;

const de: PdfCopy = {
  type: "Art",
  delivery: "Lieferung",
  pickup: "Abholung",
  planned: "Geplant",
  name: "Name",
  phone: "Telefon",
  address: "Adresse",
  note: "Hinweis",
  table: "Tisch",
  order: "Bestellung Nr.",
  paidOnline: "ONLINE BEZAHLT",
  paidReward: "MIT GUTSCHEIN BEZAHLT",
  reward: "Gutschein",
  net: "Netto",
  vat: `MwSt. ${VAT_RATE_LABEL} % (enthalten)`,
  total: "GESAMT",
  vatNote: `Gesamtbetrag inkl. ${VAT_RATE_LABEL} % MwSt.`,
  unpaid: ["Die Zahlung erfolgt im", "Restaurant - dies ist", "keine Rechnung."],
  paid: ["Online bezahlt - vielen Dank."],
  paidWithReward: ["Mit Gutschein bezahlt -", "guten Appetit."],
  thanks: "Vielen Dank & bis bald!",
};

const es: PdfCopy = {
  type: "Tipo",
  delivery: "Entrega",
  pickup: "Recogida",
  planned: "Previsto",
  name: "Nombre",
  phone: "Telefono",
  address: "Direccion",
  note: "Nota",
  table: "Mesa",
  order: "Pedido n.",
  paidOnline: "PAGADO ONLINE",
  paidReward: "PAGADO CON VALE",
  reward: "Vale",
  net: "Base imp.",
  vat: `IVA ${VAT_RATE_LABEL} % (incl.)`,
  total: "TOTAL",
  vatNote: `IVA del ${VAT_RATE_LABEL} % incluido en el total.`,
  unpaid: ["El pago se realiza en el", "restaurante - esto no es", "una factura."],
  paid: ["Pagado online - gracias."],
  paidWithReward: ["Pagado con tu vale -", "buen provecho."],
  thanks: "Gracias y hasta pronto!",
};

const it: PdfCopy = {
  type: "Tipo",
  delivery: "Consegna",
  pickup: "Ritiro",
  planned: "Previsto",
  name: "Nome",
  phone: "Telefono",
  address: "Indirizzo",
  note: "Nota",
  table: "Tavolo",
  order: "Ordine n.",
  paidOnline: "PAGATO ONLINE",
  paidReward: "PAGATO CON BUONO",
  reward: "Buono",
  net: "Imponibile",
  vat: `IVA ${VAT_RATE_LABEL}% (inclusa)`,
  total: "TOTALE",
  vatNote: `Totale con IVA al ${VAT_RATE_LABEL}% inclusa.`,
  unpaid: ["Il pagamento avviene al", "ristorante - questa non e", "una fattura fiscale."],
  paid: ["Pagato online - grazie."],
  paidWithReward: ["Pagato con il tuo buono -", "buon appetito."],
  thanks: "Grazie e a presto!",
};

export const PDF_COPY: Record<UiLocale, PdfCopy> = {
  en,
  de,
  es,
  it,
  // Decision 4 — see the header comment: the PDF font cannot draw Arabic.
  ar: en,
};

/**
 * The locale the PDF actually renders in: `ar` degrades to `en` so the
 * NUMBERS and DATES don't come out as Arabic-Indic digits that `safe()`
 * would then strip, leaving blanks where the prices should be.
 */
export function pdfLocale(locale?: string | null): UiLocale {
  const resolved = uiLocale(locale);
  return resolved === "ar" ? "en" : resolved;
}

export const pdfCopy = (locale?: string | null): PdfCopy => PDF_COPY[pdfLocale(locale)];
