import type { UiLocale } from "@/lib/locales";
import { uiLocale } from "@/lib/locales";
import { VAT_RATE_LABEL } from "@/lib/vat";

/**
 * Copy for the two transactional emails: the guest's receipt and the
 * owner's "new order" kitchen ticket. Both follow the venue's default
 * locale — the guest receipt because that is the language the venue sells
 * in, the ticket because the owner reads it.
 *
 * Kept in `src/lib/i18n/` rather than inside the templates so the
 * completeness test can walk every namespace the same way, and so a
 * translator never has to open a React file.
 */

/* ------------------------------------------------------------------ */
/* Guest receipt                                                       */
/* ------------------------------------------------------------------ */

const receiptEn = {
  subject: (n: string, venue: string) => `Your order #${n} at ${venue}`,
  heading: (n: string) => `Order #${n}`,
  thanks: "Thank you for your order!",
  table: "Table",
  pickup: "Pickup",
  delivery: "Delivery",
  planned: "Planned for",
  asap: "as soon as possible",
  net: "Net",
  vat: `VAT ${VAT_RATE_LABEL}% (included)`,
  total: "Total",
  vatNote: `All prices include ${VAT_RATE_LABEL}% VAT.`,
  paidCard: "Paid online (card).",
  paidPaypal: "Paid online (PayPal).",
  unpaidDineIn: "Payment is settled at the restaurant.",
  unpaidPickup: "Payment is settled at pickup.",
  unpaidDelivery: "Payment is settled on delivery.",
  pdf: "Download receipt (PDF)",
  track: "Track your order",
  notInvoice: "This is an order confirmation, not a tax invoice.",
};

export type ReceiptCopy = typeof receiptEn;

const receiptDe: ReceiptCopy = {
  subject: (n, venue) => `Ihre Bestellung Nr. ${n} bei ${venue}`,
  heading: (n) => `Bestellung Nr. ${n}`,
  thanks: "Vielen Dank für Ihre Bestellung!",
  table: "Tisch",
  pickup: "Abholung",
  delivery: "Lieferung",
  planned: "Geplant für",
  asap: "so bald wie möglich",
  net: "Netto",
  vat: `MwSt. ${VAT_RATE_LABEL} % (enthalten)`,
  total: "Gesamt",
  vatNote: `Alle Preise inkl. ${VAT_RATE_LABEL} % MwSt.`,
  paidCard: "Online bezahlt (Karte).",
  paidPaypal: "Online bezahlt (PayPal).",
  unpaidDineIn: "Die Zahlung erfolgt im Restaurant.",
  unpaidPickup: "Die Zahlung erfolgt bei der Abholung.",
  unpaidDelivery: "Die Zahlung erfolgt bei der Lieferung.",
  pdf: "Beleg als PDF herunterladen",
  track: "Bestellstatus verfolgen",
  notInvoice: "Dies ist eine Bestellbestätigung, keine Rechnung.",
};

const receiptEs: ReceiptCopy = {
  subject: (n, venue) => `Tu pedido n.º ${n} en ${venue}`,
  heading: (n) => `Pedido n.º ${n}`,
  thanks: "¡Gracias por tu pedido!",
  table: "Mesa",
  pickup: "Recogida",
  delivery: "Entrega",
  planned: "Previsto para",
  asap: "lo antes posible",
  net: "Base imponible",
  vat: `IVA ${VAT_RATE_LABEL} % (incluido)`,
  total: "Total",
  vatNote: `Todos los precios incluyen el ${VAT_RATE_LABEL} % de IVA.`,
  paidCard: "Pagado online (tarjeta).",
  paidPaypal: "Pagado online (PayPal).",
  unpaidDineIn: "El pago se realiza en el restaurante.",
  unpaidPickup: "El pago se realiza al recoger.",
  unpaidDelivery: "El pago se realiza en la entrega.",
  pdf: "Descargar el recibo (PDF)",
  track: "Seguir el estado del pedido",
  notInvoice: "Esto es una confirmación de pedido, no una factura.",
};

const receiptIt: ReceiptCopy = {
  subject: (n, venue) => `Il tuo ordine n. ${n} da ${venue}`,
  heading: (n) => `Ordine n. ${n}`,
  thanks: "Grazie per il tuo ordine!",
  table: "Tavolo",
  pickup: "Ritiro",
  delivery: "Consegna",
  planned: "Previsto per",
  asap: "il prima possibile",
  net: "Imponibile",
  vat: `IVA ${VAT_RATE_LABEL}% (inclusa)`,
  total: "Totale",
  vatNote: `Tutti i prezzi includono l'IVA al ${VAT_RATE_LABEL}%.`,
  paidCard: "Pagato online (carta).",
  paidPaypal: "Pagato online (PayPal).",
  unpaidDineIn: "Il pagamento avviene al ristorante.",
  unpaidPickup: "Il pagamento avviene al ritiro.",
  unpaidDelivery: "Il pagamento avviene alla consegna.",
  pdf: "Scarica la ricevuta (PDF)",
  track: "Segui lo stato dell'ordine",
  notInvoice: "Questa è una conferma d'ordine, non una fattura fiscale.",
};

const receiptAr: ReceiptCopy = {
  subject: (n, venue) => `طلبك رقم ${n} لدى ${venue}`,
  heading: (n) => `الطلب رقم ${n}`,
  thanks: "شكرًا لطلبك!",
  table: "طاولة",
  pickup: "استلام",
  delivery: "توصيل",
  planned: "مُقرَّر في",
  asap: "في أقرب وقت ممكن",
  net: "الصافي",
  vat: `ضريبة القيمة المضافة ${VAT_RATE_LABEL}% (مشمولة)`,
  total: "الإجمالي",
  vatNote: `جميع الأسعار تشمل ضريبة القيمة المضافة ${VAT_RATE_LABEL}%.`,
  paidCard: "مدفوع عبر الإنترنت (بطاقة).",
  paidPaypal: "مدفوع عبر الإنترنت (PayPal).",
  unpaidDineIn: "يتم الدفع في المطعم.",
  unpaidPickup: "يتم الدفع عند الاستلام.",
  unpaidDelivery: "يتم الدفع عند التوصيل.",
  pdf: "تنزيل الإيصال (PDF)",
  track: "تتبّع حالة الطلب",
  notInvoice: "هذا تأكيد طلب وليس فاتورة ضريبية.",
};

export const RECEIPT_COPY: Record<UiLocale, ReceiptCopy> = {
  en: receiptEn,
  de: receiptDe,
  es: receiptEs,
  it: receiptIt,
  ar: receiptAr,
};

export const receiptCopy = (locale?: string | null): ReceiptCopy => RECEIPT_COPY[uiLocale(locale)];

/* ------------------------------------------------------------------ */
/* Owner kitchen ticket                                                */
/* ------------------------------------------------------------------ */

const newOrderEn = {
  subject: (n: string, where: string, total: string) => `New order #${n} · ${where} · ${total}`,
  heading: (n: string) => `New order #${n}`,
  dineIn: "Dine-in",
  table: (t: string) => `Table ${t}`,
  noTable: "no table number",
  pickup: "Pickup",
  delivery: "Delivery",
  planned: "Wanted for",
  asap: "as soon as possible",
  guest: "Guest",
  phone: "Phone",
  address: "Address",
  addressNote: "Address note",
  total: "Total",
  paidCard: "Paid online (card) — nothing to collect.",
  paidPaypal: "Paid online (PayPal) — nothing to collect.",
  unpaid: (total: string) => `Not paid yet — collect ${total} on site.`,
  open: "Open the order on the kitchen board",
  placedAt: "Received",
  footer: "This alert goes to the addresses under Dashboard → Settings → Ordering.",
};

export type NewOrderCopy = typeof newOrderEn;

const newOrderDe: NewOrderCopy = {
  subject: (n, where, total) => `Neue Bestellung Nr. ${n} · ${where} · ${total}`,
  heading: (n) => `Neue Bestellung Nr. ${n}`,
  dineIn: "Im Restaurant",
  table: (t) => `Tisch ${t}`,
  noTable: "ohne Tischnummer",
  pickup: "Abholung",
  delivery: "Lieferung",
  planned: "Gewünscht für",
  asap: "so bald wie möglich",
  guest: "Gast",
  phone: "Telefon",
  address: "Adresse",
  addressNote: "Hinweis zur Adresse",
  total: "Gesamt",
  paidCard: "Online bezahlt (Karte) — nichts mehr kassieren.",
  paidPaypal: "Online bezahlt (PayPal) — nichts mehr kassieren.",
  unpaid: (total) => `Noch nicht bezahlt — ${total} vor Ort kassieren.`,
  open: "Bestellung in der Küchenansicht öffnen",
  placedAt: "Eingegangen",
  footer:
    "Diese Benachrichtigung geht an die Adressen unter Dashboard → Einstellungen → Bestellungen.",
};

const newOrderEs: NewOrderCopy = {
  subject: (n, where, total) => `Nuevo pedido n.º ${n} · ${where} · ${total}`,
  heading: (n) => `Nuevo pedido n.º ${n}`,
  dineIn: "En el local",
  table: (t) => `Mesa ${t}`,
  noTable: "sin número de mesa",
  pickup: "Recogida",
  delivery: "Entrega",
  planned: "Solicitado para",
  asap: "lo antes posible",
  guest: "Cliente",
  phone: "Teléfono",
  address: "Dirección",
  addressNote: "Nota de la dirección",
  total: "Total",
  paidCard: "Pagado online (tarjeta): no hay que cobrar nada.",
  paidPaypal: "Pagado online (PayPal): no hay que cobrar nada.",
  unpaid: (total) => `Aún sin pagar: cobrar ${total} en el local.`,
  open: "Abrir el pedido en la vista de cocina",
  placedAt: "Recibido",
  footer: "Este aviso se envía a las direcciones de Panel → Ajustes → Pedidos.",
};

const newOrderIt: NewOrderCopy = {
  subject: (n, where, total) => `Nuovo ordine n. ${n} · ${where} · ${total}`,
  heading: (n) => `Nuovo ordine n. ${n}`,
  dineIn: "Al tavolo",
  table: (t) => `Tavolo ${t}`,
  noTable: "senza numero di tavolo",
  pickup: "Ritiro",
  delivery: "Consegna",
  planned: "Richiesto per",
  asap: "il prima possibile",
  guest: "Cliente",
  phone: "Telefono",
  address: "Indirizzo",
  addressNote: "Nota sull'indirizzo",
  total: "Totale",
  paidCard: "Pagato online (carta): non c'è nulla da incassare.",
  paidPaypal: "Pagato online (PayPal): non c'è nulla da incassare.",
  unpaid: (total) => `Non ancora pagato: incassare ${total} sul posto.`,
  open: "Apri l'ordine nella vista cucina",
  placedAt: "Ricevuto",
  footer: "Questo avviso arriva agli indirizzi in Dashboard → Impostazioni → Ordini.",
};

const newOrderAr: NewOrderCopy = {
  subject: (n, where, total) => `طلب جديد رقم ${n} · ${where} · ${total}`,
  heading: (n) => `طلب جديد رقم ${n}`,
  dineIn: "في المطعم",
  table: (t) => `طاولة ${t}`,
  noTable: "بدون رقم طاولة",
  pickup: "استلام",
  delivery: "توصيل",
  planned: "مطلوب في",
  asap: "في أقرب وقت ممكن",
  guest: "الضيف",
  phone: "الهاتف",
  address: "العنوان",
  addressNote: "ملاحظة على العنوان",
  total: "الإجمالي",
  paidCard: "مدفوع عبر الإنترنت (بطاقة) — لا شيء للتحصيل.",
  paidPaypal: "مدفوع عبر الإنترنت (PayPal) — لا شيء للتحصيل.",
  unpaid: (total) => `غير مدفوع بعد — حصّل ${total} في الموقع.`,
  open: "افتح الطلب في شاشة المطبخ",
  placedAt: "ورد في",
  footer: "يصل هذا التنبيه إلى العناوين المحددة في لوحة التحكم ← الإعدادات ← الطلبات.",
};

export const NEW_ORDER_COPY: Record<UiLocale, NewOrderCopy> = {
  en: newOrderEn,
  de: newOrderDe,
  es: newOrderEs,
  it: newOrderIt,
  ar: newOrderAr,
};

export const newOrderCopy = (locale?: string | null): NewOrderCopy =>
  NEW_ORDER_COPY[uiLocale(locale)];
