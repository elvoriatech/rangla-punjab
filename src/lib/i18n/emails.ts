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
  thankYou: "Thank You!",
  received: "Your order has been received.",
  preparing: "We are preparing it with care and look forward to serving you!",
  orderNumber: "Order number",
  item: "Item",
  price: "Price",
  featFresh: "Fresh ingredients",
  featAuthentic: "Authentic recipes",
  featHospitality: "Warm hospitality",
  tagline: "Good food brings people together",
  subject: (n: string, venue: string) => `Your order #${n} at ${venue}`,
  heading: (n: string) => `Order #${n}`,
  thanks: "Thank you for your order!",
  table: "Table",
  pickup: "Pickup",
  delivery: "Delivery",
  planned: "Planned for",
  asap: "as soon as possible",
  reward: "Reward",
  rewardPoints: (points: string) => `Reward · ${points} points`,
  giftCard: "Gift card",
  giftCardCode: (last4: string) => `Gift card ····${last4}`,
  paidWithGiftCard: "Paid · Gift card",
  net: "Net",
  vat: `VAT ${VAT_RATE_LABEL}% (included)`,
  total: "Total",
  vatNote: `All prices include ${VAT_RATE_LABEL}% VAT.`,
  paidCard: "Paid online (card).",
  paidPaypal: "Paid online (PayPal).",
  paidVoucher: "Paid with your reward — nothing to settle.",
  unpaidDineIn: "Payment is settled at the restaurant.",
  unpaidPickup: "Payment is settled at pickup.",
  unpaidDelivery: "Payment is settled on delivery.",
  pdf: "Download receipt (PDF)",
  track: "Track your order",
  /** The secondary ask under the receipt. Only rendered when the venue
   *  has a Google Place ID, so the button always leads to the real
   *  write-a-review form. */
  rate: "Rate us on Google",
  notInvoice: "This is an order confirmation, not a tax invoice.",
};

export type ReceiptCopy = typeof receiptEn;

const receiptDe: ReceiptCopy = {
  thankYou: "Vielen Dank!",
  received: "Ihre Bestellung ist eingegangen.",
  preparing: "Wir bereiten sie mit Liebe zu und freuen uns auf Sie!",
  orderNumber: "Bestellnummer",
  item: "Artikel",
  price: "Preis",
  featFresh: "Frische Zutaten",
  featAuthentic: "Authentische Rezepte",
  featHospitality: "Herzliche Gastfreundschaft",
  tagline: "Gutes Essen bringt Menschen zusammen",
  subject: (n, venue) => `Ihre Bestellung Nr. ${n} bei ${venue}`,
  heading: (n) => `Bestellung Nr. ${n}`,
  thanks: "Vielen Dank für Ihre Bestellung!",
  table: "Tisch",
  pickup: "Abholung",
  delivery: "Lieferung",
  planned: "Geplant für",
  asap: "so bald wie möglich",
  reward: "Gutschein",
  rewardPoints: (points) => `Gutschein · ${points} Punkte`,
  giftCard: "Geschenkgutschein",
  giftCardCode: (last4) => `Geschenkgutschein ····${last4}`,
  paidWithGiftCard: "Bezahlt · Geschenkgutschein",
  net: "Netto",
  vat: `MwSt. ${VAT_RATE_LABEL} % (enthalten)`,
  total: "Gesamt",
  vatNote: `Alle Preise inkl. ${VAT_RATE_LABEL} % MwSt.`,
  paidCard: "Online bezahlt (Karte).",
  paidPaypal: "Online bezahlt (PayPal).",
  paidVoucher: "Mit Ihrem Gutschein bezahlt — nichts mehr offen.",
  unpaidDineIn: "Die Zahlung erfolgt im Restaurant.",
  unpaidPickup: "Die Zahlung erfolgt bei der Abholung.",
  unpaidDelivery: "Die Zahlung erfolgt bei der Lieferung.",
  pdf: "Beleg als PDF herunterladen",
  track: "Bestellstatus verfolgen",
  rate: "Bewerten Sie uns bei Google",
  notInvoice: "Dies ist eine Bestellbestätigung, keine Rechnung.",
};

const receiptFr: ReceiptCopy = {
  thankYou: "Merci !",
  received: "Votre commande a bien été reçue.",
  preparing: "Nous la préparons avec soin et avons hâte de vous servir !",
  orderNumber: "Numéro de commande",
  item: "Article",
  price: "Prix",
  featFresh: "Ingrédients frais",
  featAuthentic: "Recettes authentiques",
  featHospitality: "Accueil chaleureux",
  tagline: "La bonne cuisine rassemble",
  subject: (n, venue) => `Votre commande n° ${n} chez ${venue}`,
  heading: (n) => `Commande n° ${n}`,
  thanks: "Merci pour votre commande !",
  table: "Table",
  pickup: "Retrait",
  delivery: "Livraison",
  planned: "Prévue pour",
  asap: "dès que possible",
  reward: "Bon de fidélité",
  rewardPoints: (points) => `Bon de fidélité · ${points} points`,
  giftCard: "Carte cadeau",
  giftCardCode: (last4) => `Carte cadeau ····${last4}`,
  paidWithGiftCard: "Payé · Carte cadeau",
  net: "Montant HT",
  vat: `TVA ${VAT_RATE_LABEL} % (incluse)`,
  total: "Total",
  vatNote: `Tous les prix s'entendent TVA de ${VAT_RATE_LABEL} % incluse.`,
  paidCard: "Payé en ligne (carte bancaire).",
  paidPaypal: "Payé en ligne (PayPal).",
  paidVoucher: "Payé avec votre bon de fidélité — plus rien à régler.",
  unpaidDineIn: "Le paiement s'effectue au restaurant.",
  unpaidPickup: "Le paiement s'effectue au retrait.",
  unpaidDelivery: "Le paiement s'effectue à la livraison.",
  pdf: "Télécharger le reçu (PDF)",
  track: "Suivre votre commande",
  rate: "Donnez-nous votre avis sur Google",
  notInvoice: "Ceci est une confirmation de commande, et non une facture.",
};

const receiptEs: ReceiptCopy = {
  thankYou: "¡Gracias!",
  received: "Hemos recibido tu pedido.",
  preparing: "Lo preparamos con cariño y te esperamos con ganas.",
  orderNumber: "Número de pedido",
  item: "Artículo",
  price: "Precio",
  featFresh: "Ingredientes frescos",
  featAuthentic: "Recetas auténticas",
  featHospitality: "Hospitalidad cálida",
  tagline: "La buena comida une a las personas",
  subject: (n, venue) => `Tu pedido n.º ${n} en ${venue}`,
  heading: (n) => `Pedido n.º ${n}`,
  thanks: "¡Gracias por tu pedido!",
  table: "Mesa",
  pickup: "Recogida",
  delivery: "Entrega",
  planned: "Previsto para",
  asap: "lo antes posible",
  reward: "Vale",
  rewardPoints: (points) => `Vale · ${points} puntos`,
  giftCard: "Tarjeta regalo",
  giftCardCode: (last4) => `Tarjeta regalo ····${last4}`,
  paidWithGiftCard: "Pagado · Tarjeta regalo",
  net: "Base imponible",
  vat: `IVA ${VAT_RATE_LABEL} % (incluido)`,
  total: "Total",
  vatNote: `Todos los precios incluyen el ${VAT_RATE_LABEL} % de IVA.`,
  paidCard: "Pagado online (tarjeta).",
  paidPaypal: "Pagado online (PayPal).",
  paidVoucher: "Pagado con tu vale: no queda nada por abonar.",
  unpaidDineIn: "El pago se realiza en el restaurante.",
  unpaidPickup: "El pago se realiza al recoger.",
  unpaidDelivery: "El pago se realiza en la entrega.",
  pdf: "Descargar el recibo (PDF)",
  track: "Seguir el estado del pedido",
  rate: "Valóranos en Google",
  notInvoice: "Esto es una confirmación de pedido, no una factura.",
};

const receiptIt: ReceiptCopy = {
  thankYou: "Grazie!",
  received: "Il tuo ordine è stato ricevuto.",
  preparing: "Lo prepariamo con cura e non vediamo l'ora di servirti!",
  orderNumber: "Numero d'ordine",
  item: "Articolo",
  price: "Prezzo",
  featFresh: "Ingredienti freschi",
  featAuthentic: "Ricette autentiche",
  featHospitality: "Calda ospitalità",
  tagline: "Il buon cibo unisce le persone",
  subject: (n, venue) => `Il tuo ordine n. ${n} da ${venue}`,
  heading: (n) => `Ordine n. ${n}`,
  thanks: "Grazie per il tuo ordine!",
  table: "Tavolo",
  pickup: "Ritiro",
  delivery: "Consegna",
  planned: "Previsto per",
  asap: "il prima possibile",
  reward: "Buono",
  rewardPoints: (points) => `Buono · ${points} punti`,
  giftCard: "Carta regalo",
  giftCardCode: (last4) => `Carta regalo ····${last4}`,
  paidWithGiftCard: "Pagato · Carta regalo",
  net: "Imponibile",
  vat: `IVA ${VAT_RATE_LABEL}% (inclusa)`,
  total: "Totale",
  vatNote: `Tutti i prezzi includono l'IVA al ${VAT_RATE_LABEL}%.`,
  paidCard: "Pagato online (carta).",
  paidPaypal: "Pagato online (PayPal).",
  paidVoucher: "Pagato con il tuo buono: non resta nulla da saldare.",
  unpaidDineIn: "Il pagamento avviene al ristorante.",
  unpaidPickup: "Il pagamento avviene al ritiro.",
  unpaidDelivery: "Il pagamento avviene alla consegna.",
  pdf: "Scarica la ricevuta (PDF)",
  track: "Segui lo stato dell'ordine",
  rate: "Valutaci su Google",
  notInvoice: "Questa è una conferma d'ordine, non una fattura fiscale.",
};

const receiptAr: ReceiptCopy = {
  thankYou: "شكرًا لك!",
  received: "تم استلام طلبك.",
  preparing: "نحضّره بعناية ونتطلع إلى خدمتك!",
  orderNumber: "رقم الطلب",
  item: "الصنف",
  price: "السعر",
  featFresh: "مكونات طازجة",
  featAuthentic: "وصفات أصيلة",
  featHospitality: "ضيافة دافئة",
  tagline: "الطعام الطيب يجمع الناس",
  subject: (n, venue) => `طلبك رقم ${n} لدى ${venue}`,
  heading: (n) => `الطلب رقم ${n}`,
  thanks: "شكرًا لطلبك!",
  table: "طاولة",
  pickup: "استلام",
  delivery: "توصيل",
  planned: "مُقرَّر في",
  asap: "في أقرب وقت ممكن",
  reward: "قسيمة",
  rewardPoints: (points) => `قسيمة · ${points} نقطة`,
  giftCard: "بطاقة هدايا",
  giftCardCode: (last4) => `بطاقة هدايا ····${last4}`,
  paidWithGiftCard: "مدفوع · بطاقة هدايا",
  net: "الصافي",
  vat: `ضريبة القيمة المضافة ${VAT_RATE_LABEL}% (مشمولة)`,
  total: "الإجمالي",
  vatNote: `جميع الأسعار تشمل ضريبة القيمة المضافة ${VAT_RATE_LABEL}%.`,
  paidCard: "مدفوع عبر الإنترنت (بطاقة).",
  paidPaypal: "مدفوع عبر الإنترنت (PayPal).",
  paidVoucher: "مدفوع بقسيمة المكافأة — لا يوجد مبلغ مستحق.",
  unpaidDineIn: "يتم الدفع في المطعم.",
  unpaidPickup: "يتم الدفع عند الاستلام.",
  unpaidDelivery: "يتم الدفع عند التوصيل.",
  pdf: "تنزيل الإيصال (PDF)",
  track: "تتبّع حالة الطلب",
  rate: "قيّمنا على Google",
  notInvoice: "هذا تأكيد طلب وليس فاتورة ضريبية.",
};

export const RECEIPT_COPY: Record<UiLocale, ReceiptCopy> = {
  en: receiptEn,
  de: receiptDe,
  fr: receiptFr,
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
  reward: "Reward",
  rewardPoints: (points: string) => `Reward · ${points} points`,
  giftCard: "Gift card",
  giftCardCode: (last4: string) => `Gift card ····${last4}`,
  paidWithGiftCard: "Paid · Gift card",
  total: "Total",
  paidCard: "Paid online (card) — nothing to collect.",
  paidPaypal: "Paid online (PayPal) — nothing to collect.",
  paidVoucher: "Paid with a loyalty reward — nothing to collect.",
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
  reward: "Gutschein",
  rewardPoints: (points) => `Gutschein · ${points} Punkte`,
  giftCard: "Geschenkgutschein",
  giftCardCode: (last4) => `Geschenkgutschein ····${last4}`,
  paidWithGiftCard: "Bezahlt · Geschenkgutschein",
  total: "Gesamt",
  paidCard: "Online bezahlt (Karte) — nichts mehr kassieren.",
  paidPaypal: "Online bezahlt (PayPal) — nichts mehr kassieren.",
  paidVoucher: "Mit Treuegutschein bezahlt — nichts mehr kassieren.",
  unpaid: (total) => `Noch nicht bezahlt — ${total} vor Ort kassieren.`,
  open: "Bestellung in der Küchenansicht öffnen",
  placedAt: "Eingegangen",
  footer:
    "Diese Benachrichtigung geht an die Adressen unter Dashboard → Einstellungen → Bestellungen.",
};

const newOrderFr: NewOrderCopy = {
  subject: (n, where, total) => `Nouvelle commande n° ${n} · ${where} · ${total}`,
  heading: (n) => `Nouvelle commande n° ${n}`,
  dineIn: "Sur place",
  table: (t) => `Table ${t}`,
  noTable: "sans numéro de table",
  pickup: "Retrait",
  delivery: "Livraison",
  planned: "Souhaitée pour",
  asap: "dès que possible",
  guest: "Client",
  phone: "Téléphone",
  address: "Adresse",
  addressNote: "Remarque sur l'adresse",
  reward: "Bon de fidélité",
  rewardPoints: (points) => `Bon de fidélité · ${points} points`,
  giftCard: "Carte cadeau",
  giftCardCode: (last4) => `Carte cadeau ····${last4}`,
  paidWithGiftCard: "Payé · Carte cadeau",
  total: "Total",
  paidCard: "Payé en ligne (carte bancaire) — rien à encaisser.",
  paidPaypal: "Payé en ligne (PayPal) — rien à encaisser.",
  paidVoucher: "Payé avec un bon de fidélité — rien à encaisser.",
  unpaid: (total) => `Pas encore payé — encaisser ${total} sur place.`,
  open: "Ouvrir la commande sur l'écran cuisine",
  placedAt: "Reçue le",
  footer:
    "Cette alerte est envoyée aux adresses indiquées dans Tableau de bord → Réglages → Commandes.",
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
  reward: "Vale",
  rewardPoints: (points) => `Vale · ${points} puntos`,
  giftCard: "Tarjeta regalo",
  giftCardCode: (last4) => `Tarjeta regalo ····${last4}`,
  paidWithGiftCard: "Pagado · Tarjeta regalo",
  total: "Total",
  paidCard: "Pagado online (tarjeta): no hay que cobrar nada.",
  paidPaypal: "Pagado online (PayPal): no hay que cobrar nada.",
  paidVoucher: "Pagado con un vale de fidelidad: no hay que cobrar nada.",
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
  reward: "Buono",
  rewardPoints: (points) => `Buono · ${points} punti`,
  giftCard: "Carta regalo",
  giftCardCode: (last4) => `Carta regalo ····${last4}`,
  paidWithGiftCard: "Pagato · Carta regalo",
  total: "Totale",
  paidCard: "Pagato online (carta): non c'è nulla da incassare.",
  paidPaypal: "Pagato online (PayPal): non c'è nulla da incassare.",
  paidVoucher: "Pagato con un buono fedeltà: non c'è nulla da incassare.",
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
  reward: "قسيمة",
  rewardPoints: (points) => `قسيمة · ${points} نقطة`,
  giftCard: "بطاقة هدايا",
  giftCardCode: (last4) => `بطاقة هدايا ····${last4}`,
  paidWithGiftCard: "مدفوع · بطاقة هدايا",
  total: "الإجمالي",
  paidCard: "مدفوع عبر الإنترنت (بطاقة) — لا شيء للتحصيل.",
  paidPaypal: "مدفوع عبر الإنترنت (PayPal) — لا شيء للتحصيل.",
  paidVoucher: "مدفوع بقسيمة ولاء — لا شيء للتحصيل.",
  unpaid: (total) => `غير مدفوع بعد — حصّل ${total} في الموقع.`,
  open: "افتح الطلب في شاشة المطبخ",
  placedAt: "ورد في",
  footer: "يصل هذا التنبيه إلى العناوين المحددة في لوحة التحكم ← الإعدادات ← الطلبات.",
};

export const NEW_ORDER_COPY: Record<UiLocale, NewOrderCopy> = {
  en: newOrderEn,
  de: newOrderDe,
  fr: newOrderFr,
  es: newOrderEs,
  it: newOrderIt,
  ar: newOrderAr,
};

export const newOrderCopy = (locale?: string | null): NewOrderCopy =>
  NEW_ORDER_COPY[uiLocale(locale)];

/* ------------------------------------------------------------------ */
/* Owner alert: a guest reported a problem                             */
/* ------------------------------------------------------------------ */

/**
 * Sent on every GUEST message in a complaint thread — the first one and
 * every follow-up — to the same inboxes the kitchen ticket goes to. Never
 * on the restaurant's own replies.
 *
 * Written to be answerable from a phone: the subject names the order, the
 * body carries the guest's own words verbatim and one button into the
 * thread. It deliberately does NOT try to summarise or triage — the
 * person reading it is the one who cooked the food.
 */
const newIssueEn = {
  subject: (n: string) => `Problem reported on order #${n}`,
  eyebrow: "Guest complaint",
  heading: (n: string) => `A problem with order #${n}`,
  lead: "A guest says something went wrong with their order. They are waiting to hear back.",
  pill: "Needs an answer",
  guest: "Guest",
  phone: "Phone",
  placedAt: "Order placed",
  reportedAt: "Reported",
  message: "What the guest wrote",
  photo: "The guest attached a photo — open the thread to see it.",
  open: "Open the complaint",
  footer: "This alert goes to the addresses under Dashboard → Settings → Ordering.",
};

export type NewIssueCopy = typeof newIssueEn;

const newIssueDe: NewIssueCopy = {
  subject: (n) => `Problem zu Bestellung Nr. ${n} gemeldet`,
  eyebrow: "Reklamation",
  heading: (n) => `Ein Problem mit Bestellung Nr. ${n}`,
  lead: "Ein Gast meldet, dass bei seiner Bestellung etwas schiefgelaufen ist, und wartet auf Antwort.",
  pill: "Antwort nötig",
  guest: "Gast",
  phone: "Telefon",
  placedAt: "Bestellt am",
  reportedAt: "Gemeldet",
  message: "Das schreibt der Gast",
  photo: "Der Gast hat ein Foto angehängt — im Verlauf ansehen.",
  open: "Reklamation öffnen",
  footer:
    "Diese Benachrichtigung geht an die Adressen unter Dashboard → Einstellungen → Bestellungen.",
};

const newIssueFr: NewIssueCopy = {
  subject: (n) => `Problème signalé sur la commande n° ${n}`,
  eyebrow: "Réclamation client",
  heading: (n) => `Un problème avec la commande n° ${n}`,
  lead: "Un client signale que sa commande ne s'est pas passée comme prévu. Il attend votre réponse.",
  pill: "Réponse attendue",
  guest: "Client",
  phone: "Téléphone",
  placedAt: "Commande passée le",
  reportedAt: "Signalé le",
  message: "Ce qu'écrit le client",
  photo: "Le client a joint une photo — ouvrez la conversation pour la voir.",
  open: "Ouvrir la réclamation",
  footer:
    "Cette alerte est envoyée aux adresses indiquées dans Tableau de bord → Réglages → Commandes.",
};

const newIssueEs: NewIssueCopy = {
  subject: (n) => `Problema notificado en el pedido n.º ${n}`,
  eyebrow: "Reclamación",
  heading: (n) => `Un problema con el pedido n.º ${n}`,
  lead: "Un cliente dice que algo salió mal con su pedido y espera una respuesta.",
  pill: "Necesita respuesta",
  guest: "Cliente",
  phone: "Teléfono",
  placedAt: "Pedido realizado",
  reportedAt: "Notificado",
  message: "Lo que escribe el cliente",
  photo: "El cliente adjuntó una foto: ábrela en la conversación.",
  open: "Abrir la reclamación",
  footer: "Este aviso se envía a las direcciones de Panel → Ajustes → Pedidos.",
};

const newIssueIt: NewIssueCopy = {
  subject: (n) => `Problema segnalato sull'ordine n. ${n}`,
  eyebrow: "Reclamo",
  heading: (n) => `Un problema con l'ordine n. ${n}`,
  lead: "Un cliente segnala che qualcosa è andato storto con il suo ordine e attende una risposta.",
  pill: "Serve una risposta",
  guest: "Cliente",
  phone: "Telefono",
  placedAt: "Ordine effettuato",
  reportedAt: "Segnalato",
  message: "Cosa scrive il cliente",
  photo: "Il cliente ha allegato una foto: aprila nella conversazione.",
  open: "Apri il reclamo",
  footer: "Questo avviso arriva agli indirizzi in Dashboard → Impostazioni → Ordini.",
};

const newIssueAr: NewIssueCopy = {
  subject: (n) => `تم الإبلاغ عن مشكلة في الطلب رقم ${n}`,
  eyebrow: "شكوى ضيف",
  heading: (n) => `مشكلة في الطلب رقم ${n}`,
  lead: "يقول أحد الضيوف إن شيئًا ما لم يكن على ما يرام في طلبه، وهو بانتظار ردّكم.",
  pill: "بحاجة إلى ردّ",
  guest: "الضيف",
  phone: "الهاتف",
  placedAt: "تاريخ الطلب",
  reportedAt: "تم الإبلاغ",
  message: "ما كتبه الضيف",
  photo: "أرفق الضيف صورة — افتح المحادثة لعرضها.",
  open: "فتح الشكوى",
  footer: "يصل هذا التنبيه إلى العناوين المحددة في لوحة التحكم ← الإعدادات ← الطلبات.",
};

export const NEW_ISSUE_COPY: Record<UiLocale, NewIssueCopy> = {
  en: newIssueEn,
  de: newIssueDe,
  fr: newIssueFr,
  es: newIssueEs,
  it: newIssueIt,
  ar: newIssueAr,
};

export const newIssueCopy = (locale?: string | null): NewIssueCopy =>
  NEW_ISSUE_COPY[uiLocale(locale)];

/* ------------------------------------------------------------------ */
/* Loyalty: "you've earned a free meal"                                */
/* ------------------------------------------------------------------ */

/**
 * Sent once, the moment a customer's points convert into a voucher. The
 * value and the expiry date are pre-formatted by the caller (`formatPrice`
 * / `Intl.DateTimeFormat` in the venue's timezone), so these strings never
 * do money or calendar maths.
 */
const rewardEn = {
  subject: (value: string) => `Hurra! You've earned a ${value} meal`,
  eyebrow: "Your reward",
  heading: "A meal on us 🎉",
  lead: (value: string) =>
    `You've collected enough points for a free meal worth ${value}. Thank you for eating with us!`,
  whereToFind:
    "Your voucher is waiting in the app under Account → Rewards. Open it when you order and we'll take it from there.",
  expiry: (date: string) => `Valid until ${date}.`,
  cta: "See my rewards",
  keepGoing: "Points keep adding up — the next order starts the next reward.",
  footer: "You're getting this because you collect points when you order with us.",
};

export type RewardCopy = typeof rewardEn;

const rewardDe: RewardCopy = {
  subject: (value) => `Hurra! Sie haben ein Essen im Wert von ${value} verdient`,
  eyebrow: "Ihre Belohnung",
  heading: "Ein Essen geht auf uns 🎉",
  lead: (value) =>
    `Sie haben genug Punkte für ein Gratis-Essen im Wert von ${value} gesammelt. Danke, dass Sie bei uns essen!`,
  whereToFind:
    "Ihr Gutschein liegt in der App unter Konto → Belohnungen bereit. Öffnen Sie ihn beim Bestellen — um den Rest kümmern wir uns.",
  expiry: (date) => `Gültig bis ${date}.`,
  cta: "Meine Belohnungen ansehen",
  keepGoing: "Punkte sammeln weiter — mit der nächsten Bestellung beginnt die nächste Belohnung.",
  footer: "Sie erhalten diese E-Mail, weil Sie bei Ihren Bestellungen Punkte sammeln.",
};

const rewardFr: RewardCopy = {
  subject: (value) => `Bravo ! Vous avez gagné un repas d'une valeur de ${value}`,
  eyebrow: "Votre récompense",
  heading: "Un repas offert 🎉",
  lead: (value) =>
    `Vous avez cumulé assez de points pour un repas offert d'une valeur de ${value}. Merci de votre fidélité !`,
  whereToFind:
    "Votre bon vous attend dans l'application, sous Compte → Récompenses. Ouvrez-le au moment de commander et nous nous occupons du reste.",
  expiry: (date) => `Valable jusqu'au ${date}.`,
  cta: "Voir mes récompenses",
  keepGoing:
    "Les points continuent de s'accumuler — la prochaine commande lance la prochaine récompense.",
  footer: "Vous recevez cet e-mail parce que vous cumulez des points à chaque commande chez nous.",
};

const rewardEs: RewardCopy = {
  subject: (value) => `¡Hurra! Has ganado una comida de ${value}`,
  eyebrow: "Tu recompensa",
  heading: "Una comida invita la casa 🎉",
  lead: (value) =>
    `Has reunido puntos suficientes para una comida gratis de ${value}. ¡Gracias por comer con nosotros!`,
  whereToFind:
    "Tu vale te espera en la app, en Cuenta → Recompensas. Ábrelo al hacer el pedido y nosotros nos encargamos del resto.",
  expiry: (date) => `Válido hasta el ${date}.`,
  cta: "Ver mis recompensas",
  keepGoing: "Los puntos siguen sumando: el próximo pedido empieza la próxima recompensa.",
  footer: "Recibes este correo porque acumulas puntos cuando pides con nosotros.",
};

const rewardIt: RewardCopy = {
  subject: (value) => `Evviva! Hai guadagnato un pasto da ${value}`,
  eyebrow: "Il tuo premio",
  heading: "Un pasto offerto da noi 🎉",
  lead: (value) =>
    `Hai raccolto punti sufficienti per un pasto gratuito da ${value}. Grazie per aver mangiato da noi!`,
  whereToFind:
    "Il tuo buono ti aspetta nell'app in Account → Premi. Aprilo quando ordini: al resto pensiamo noi.",
  expiry: (date) => `Valido fino al ${date}.`,
  cta: "Vedi i miei premi",
  keepGoing: "I punti continuano ad accumularsi: il prossimo ordine avvia il prossimo premio.",
  footer: "Ricevi questa email perché accumuli punti quando ordini da noi.",
};

const rewardAr: RewardCopy = {
  subject: (value) => `مبروك! لقد ربحت وجبة بقيمة ${value}`,
  eyebrow: "مكافأتك",
  heading: "وجبة على حسابنا 🎉",
  lead: (value) => `لقد جمعت نقاطًا تكفي لوجبة مجانية بقيمة ${value}. شكرًا لتناولك الطعام لدينا!`,
  whereToFind: "قسيمتك بانتظارك في التطبيق ضمن الحساب ← المكافآت. افتحها عند الطلب وسنتولى الباقي.",
  expiry: (date) => `صالحة حتى ${date}.`,
  cta: "عرض مكافآتي",
  keepGoing: "النقاط تتراكم باستمرار — الطلب التالي يبدأ المكافأة التالية.",
  footer: "تصلك هذه الرسالة لأنك تجمع نقاطًا عند الطلب لدينا.",
};

export const REWARD_COPY: Record<UiLocale, RewardCopy> = {
  en: rewardEn,
  de: rewardDe,
  fr: rewardFr,
  es: rewardEs,
  it: rewardIt,
  ar: rewardAr,
};

export const rewardCopy = (locale?: string | null): RewardCopy => REWARD_COPY[uiLocale(locale)];

/* ------------------------------------------------------------------ */
/* Guest password reset: "choose a new password"                       */
/* ------------------------------------------------------------------ */

/**
 * The guest half of the reset flow (P7-15). The owner's reset mail is a
 * platform email in English; this one lands in the inbox of somebody who
 * knows the RESTAURANT, so it is venue-branded and speaks the language
 * the guest ordered in.
 *
 * Deliberately vague about who asked: the address may belong to someone
 * who never requested anything, and the mail must read as harmless to
 * them ("you can ignore this") rather than as an alarm.
 */
const guestResetEn = {
  subject: (venue: string) => `Choose a new password for ${venue}`,
  eyebrow: "Your account",
  heading: "Choose a new password",
  lead: "Someone asked to reset the password for your guest account. If that was you, pick a new one here:",
  cta: "Choose a new password",
  orPaste: "Or paste this link into your browser:",
  expiry: "The link works once and expires in 60 minutes.",
  ignore:
    "If you didn't ask for this, you can ignore this email — your password stays exactly as it is.",
};

export type GuestResetCopy = typeof guestResetEn;

const guestResetDe: GuestResetCopy = {
  subject: (venue) => `Neues Passwort für ${venue} wählen`,
  eyebrow: "Ihr Konto",
  heading: "Neues Passwort wählen",
  lead: "Jemand hat für Ihr Gastkonto ein neues Passwort angefordert. Wenn Sie das waren, wählen Sie hier eines:",
  cta: "Neues Passwort wählen",
  orPaste: "Oder diesen Link in den Browser kopieren:",
  expiry: "Der Link funktioniert einmal und läuft nach 60 Minuten ab.",
  ignore:
    "Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail einfach — Ihr Passwort bleibt unverändert.",
};

const guestResetFr: GuestResetCopy = {
  subject: (venue) => `Choisissez un nouveau mot de passe pour ${venue}`,
  eyebrow: "Votre compte",
  heading: "Choisissez un nouveau mot de passe",
  lead: "Quelqu'un a demandé la réinitialisation du mot de passe de votre compte client. Si c'était bien vous, choisissez-en un nouveau ici :",
  cta: "Choisir un nouveau mot de passe",
  orPaste: "Ou copiez ce lien dans votre navigateur :",
  expiry: "Le lien ne fonctionne qu'une seule fois et expire au bout de 60 minutes.",
  ignore:
    "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail — votre mot de passe reste inchangé.",
};

const guestResetEs: GuestResetCopy = {
  subject: (venue) => `Elige una nueva contraseña para ${venue}`,
  eyebrow: "Tu cuenta",
  heading: "Elige una nueva contraseña",
  lead: "Alguien ha pedido restablecer la contraseña de tu cuenta. Si has sido tú, elige una nueva aquí:",
  cta: "Elegir una nueva contraseña",
  orPaste: "O pega este enlace en tu navegador:",
  expiry: "El enlace sirve una sola vez y caduca en 60 minutos.",
  ignore:
    "Si no lo has pedido tú, puedes ignorar este correo: tu contraseña se queda tal como está.",
};

const guestResetIt: GuestResetCopy = {
  subject: (venue) => `Scegli una nuova password per ${venue}`,
  eyebrow: "Il tuo account",
  heading: "Scegli una nuova password",
  lead: "Qualcuno ha chiesto di reimpostare la password del tuo account. Se sei stato tu, scegline una nuova qui:",
  cta: "Scegli una nuova password",
  orPaste: "Oppure incolla questo link nel browser:",
  expiry: "Il link funziona una volta sola e scade dopo 60 minuti.",
  ignore:
    "Se non sei stato tu a chiederlo, puoi ignorare questa email: la tua password resta invariata.",
};

const guestResetAr: GuestResetCopy = {
  subject: (venue) => `اختر كلمة مرور جديدة لدى ${venue}`,
  eyebrow: "حسابك",
  heading: "اختر كلمة مرور جديدة",
  lead: "طلب أحدهم إعادة تعيين كلمة مرور حسابك. إن كنت أنت، فاختر كلمة مرور جديدة من هنا:",
  cta: "اختيار كلمة مرور جديدة",
  orPaste: "أو انسخ هذا الرابط إلى متصفحك:",
  expiry: "يعمل الرابط مرة واحدة وتنتهي صلاحيته بعد 60 دقيقة.",
  ignore: "إن لم تطلب ذلك، فتجاهل هذه الرسالة — ستبقى كلمة مرورك كما هي.",
};

export const GUEST_RESET_COPY: Record<UiLocale, GuestResetCopy> = {
  en: guestResetEn,
  de: guestResetDe,
  fr: guestResetFr,
  es: guestResetEs,
  it: guestResetIt,
  ar: guestResetAr,
};

export const guestResetCopy = (locale?: string | null): GuestResetCopy =>
  GUEST_RESET_COPY[uiLocale(locale)];

/* ------------------------------------------------------------------ */
/* Gift card: "here is your gift card"                                 */
/* ------------------------------------------------------------------ */

/**
 * The buyer's confirmation, sent the moment the payment settles. The
 * money, the expiry date and the dashed code are all pre-formatted by
 * `gift-card-service.ts`, so these strings never do currency, calendar or
 * formatting work of their own.
 *
 * German note: a gift card is a **Geschenkgutschein** here, never a bare
 * "Gutschein" — that word is already the loyalty voucher a few blocks up,
 * and a guest who holds both must be able to tell them apart.
 */
const giftCardEn = {
  subject: (venue: string) => `Your ${venue} gift card`,
  eyebrow: "Your gift card",
  heading: "Your gift card is ready 🎁",
  lead: (value: string) =>
    `Here it is — a gift card worth ${value}. Pass it on to whoever you like.`,
  codeLabel: "Card code",
  forLabel: (name: string) => `For ${name}`,
  productLabel: "Card",
  howTo:
    "The holder shows this code at the restaurant, or uses it when ordering in the app. It is used once, for its full value.",
  expiry: (date: string) => `Valid until ${date}.`,
  cta: "Open the card",
  shareHint:
    "Send this link to the person you're giving it to — it shows the card, the code and the expiry date.",
  legal: "This is a multi-purpose voucher. It cannot be exchanged for cash.",
  footer: "You're getting this because you bought a gift card from us.",
};

export type GiftCardCopy = typeof giftCardEn;

const giftCardDe: GiftCardCopy = {
  subject: (venue) => `Ihr Geschenkgutschein für ${venue}`,
  eyebrow: "Ihr Geschenkgutschein",
  heading: "Ihr Geschenkgutschein ist fertig 🎁",
  lead: (value) =>
    `Hier ist er — ein Geschenkgutschein im Wert von ${value}. Schenken Sie ihn, wem Sie möchten.`,
  codeLabel: "Geschenkgutschein-Code",
  forLabel: (name) => `Für ${name}`,
  productLabel: "Geschenkgutschein",
  howTo:
    "Wer den Geschenkgutschein erhält, zeigt diesen Code im Restaurant vor oder gibt ihn beim Bestellen in der App ein. Er wird einmal eingelöst, über den vollen Wert.",
  expiry: (date) => `Gültig bis ${date}.`,
  cta: "Geschenkgutschein öffnen",
  shareHint:
    "Senden Sie diesen Link an die beschenkte Person — er zeigt den Geschenkgutschein, den Code und das Gültigkeitsdatum.",
  legal: "Dies ist ein Mehrzweckgutschein. Eine Barauszahlung ist ausgeschlossen.",
  footer: "Sie erhalten diese E-Mail, weil Sie bei uns einen Geschenkgutschein gekauft haben.",
};

const giftCardFr: GiftCardCopy = {
  subject: (venue) => `Votre carte cadeau ${venue}`,
  eyebrow: "Votre carte cadeau",
  heading: "Votre carte cadeau est prête 🎁",
  lead: (value) =>
    `La voici — une carte cadeau d'une valeur de ${value}. Offrez-la à qui vous voulez.`,
  codeLabel: "Code de la carte",
  forLabel: (name) => `Pour ${name}`,
  productLabel: "Carte",
  howTo:
    "Le porteur présente ce code au restaurant, ou le saisit au moment de commander dans l'application. Il s'utilise une seule fois, pour la totalité de son montant.",
  expiry: (date) => `Valable jusqu'au ${date}.`,
  cta: "Ouvrir la carte",
  shareHint:
    "Envoyez ce lien à la personne à qui vous l'offrez — il affiche la carte, le code et la date de validité.",
  legal: "Il s'agit d'un bon à usages multiples. Il ne peut pas être échangé contre des espèces.",
  footer: "Vous recevez cet e-mail parce que vous avez acheté une carte cadeau chez nous.",
};

const giftCardEs: GiftCardCopy = {
  subject: (venue) => `Tu tarjeta regalo de ${venue}`,
  eyebrow: "Tu tarjeta regalo",
  heading: "Tu tarjeta regalo está lista 🎁",
  lead: (value) =>
    `Aquí la tienes: una tarjeta regalo por valor de ${value}. Regálasela a quien quieras.`,
  codeLabel: "Código de la tarjeta",
  forLabel: (name) => `Para ${name}`,
  productLabel: "Tarjeta",
  howTo:
    "Quien la tenga muestra este código en el restaurante, o lo introduce al hacer el pedido en la app. Se canjea una sola vez, por su valor completo.",
  expiry: (date) => `Válida hasta el ${date}.`,
  cta: "Abrir la tarjeta",
  shareHint:
    "Envía este enlace a la persona a la que se la regalas: muestra la tarjeta, el código y la fecha de validez.",
  legal: "Es un bono polivalente. No se puede canjear por dinero en efectivo.",
  footer: "Recibes este correo porque nos has comprado una tarjeta regalo.",
};

const giftCardIt: GiftCardCopy = {
  subject: (venue) => `La tua carta regalo ${venue}`,
  eyebrow: "La tua carta regalo",
  heading: "La tua carta regalo è pronta 🎁",
  lead: (value) => `Eccola: una carta regalo del valore di ${value}. Regalala a chi vuoi.`,
  codeLabel: "Codice della carta",
  forLabel: (name) => `Per ${name}`,
  productLabel: "Carta",
  howTo:
    "Chi la riceve mostra questo codice al ristorante, oppure lo inserisce quando ordina nell'app. Si usa una sola volta, per l'intero valore.",
  expiry: (date) => `Valida fino al ${date}.`,
  cta: "Apri la carta",
  shareHint:
    "Invia questo link alla persona a cui la regali: mostra la carta, il codice e la data di scadenza.",
  legal: "È un buono multiuso. Non è convertibile in denaro contante.",
  footer: "Ricevi questa email perché hai acquistato una carta regalo da noi.",
};

const giftCardAr: GiftCardCopy = {
  subject: (venue) => `بطاقة الهدايا الخاصة بك من ${venue}`,
  eyebrow: "بطاقة الهدايا",
  heading: "بطاقة هداياك جاهزة 🎁",
  lead: (value) => `ها هي — بطاقة هدايا بقيمة ${value}. أهدها لمن تشاء.`,
  codeLabel: "رمز البطاقة",
  forLabel: (name) => `إلى ${name}`,
  productLabel: "البطاقة",
  howTo:
    "يُظهر حاملها هذا الرمز في المطعم، أو يستخدمه عند الطلب من التطبيق. تُستخدم مرة واحدة، بكامل قيمتها.",
  expiry: (date) => `صالحة حتى ${date}.`,
  cta: "فتح البطاقة",
  shareHint: "أرسل هذا الرابط إلى من تهديه البطاقة — يعرض البطاقة والرمز وتاريخ انتهاء الصلاحية.",
  legal: "هذه قسيمة متعددة الأغراض. لا يمكن استبدالها نقدًا.",
  footer: "تصلك هذه الرسالة لأنك اشتريت منا بطاقة هدايا.",
};

export const GIFT_CARD_COPY: Record<UiLocale, GiftCardCopy> = {
  en: giftCardEn,
  de: giftCardDe,
  fr: giftCardFr,
  es: giftCardEs,
  it: giftCardIt,
  ar: giftCardAr,
};

export const giftCardCopy = (locale?: string | null): GiftCardCopy =>
  GIFT_CARD_COPY[uiLocale(locale)];

/* ------------------------------------------------------------------ */
/* Gift card: "your card was redeemed"                                 */
/* ------------------------------------------------------------------ */

/**
 * The buyer's receipt-side note, sent when somebody spends the card. Kept
 * deliberately short — the card is gone, so there is nothing to act on
 * and nothing to click. Same German rule as above: Geschenkgutschein.
 */
const giftCardRedeemedEn = {
  subject: (venue: string) => `Your ${venue} gift card was redeemed`,
  eyebrow: "Gift card",
  heading: "Your gift card was redeemed",
  lead: (value: string) =>
    `The ${value} gift card you bought has been used. We hope it was enjoyed.`,
  codeLabel: "Card code",
  onLabel: (date: string) => `Redeemed on ${date}.`,
  footer: "You're getting this because you bought this gift card.",
};

export type GiftCardRedeemedCopy = typeof giftCardRedeemedEn;

const giftCardRedeemedDe: GiftCardRedeemedCopy = {
  subject: (venue) => `Ihr Geschenkgutschein für ${venue} wurde eingelöst`,
  eyebrow: "Geschenkgutschein",
  heading: "Ihr Geschenkgutschein wurde eingelöst",
  lead: (value) =>
    `Der von Ihnen gekaufte Geschenkgutschein über ${value} wurde eingelöst. Wir hoffen, er hat Freude gemacht.`,
  codeLabel: "Geschenkgutschein-Code",
  onLabel: (date) => `Eingelöst am ${date}.`,
  footer: "Sie erhalten diese E-Mail, weil Sie diesen Geschenkgutschein gekauft haben.",
};

const giftCardRedeemedFr: GiftCardRedeemedCopy = {
  subject: (venue) => `Votre carte cadeau ${venue} a été utilisée`,
  eyebrow: "Carte cadeau",
  heading: "Votre carte cadeau a été utilisée",
  lead: (value) =>
    `La carte cadeau de ${value} que vous avez achetée a été utilisée. Nous espérons qu'elle a fait plaisir.`,
  codeLabel: "Code de la carte",
  onLabel: (date) => `Utilisée le ${date}.`,
  footer: "Vous recevez cet e-mail parce que vous avez acheté cette carte cadeau.",
};

const giftCardRedeemedEs: GiftCardRedeemedCopy = {
  subject: (venue) => `Tu tarjeta regalo de ${venue} se ha canjeado`,
  eyebrow: "Tarjeta regalo",
  heading: "Tu tarjeta regalo se ha canjeado",
  lead: (value) =>
    `La tarjeta regalo de ${value} que compraste ya se ha utilizado. Esperamos que se haya disfrutado.`,
  codeLabel: "Código de la tarjeta",
  onLabel: (date) => `Canjeada el ${date}.`,
  footer: "Recibes este correo porque compraste esta tarjeta regalo.",
};

const giftCardRedeemedIt: GiftCardRedeemedCopy = {
  subject: (venue) => `La tua carta regalo ${venue} è stata utilizzata`,
  eyebrow: "Carta regalo",
  heading: "La tua carta regalo è stata utilizzata",
  lead: (value) =>
    `La carta regalo da ${value} che hai acquistato è stata utilizzata. Speriamo sia stata apprezzata.`,
  codeLabel: "Codice della carta",
  onLabel: (date) => `Utilizzata il ${date}.`,
  footer: "Ricevi questa email perché hai acquistato questa carta regalo.",
};

const giftCardRedeemedAr: GiftCardRedeemedCopy = {
  subject: (venue) => `تم استخدام بطاقة الهدايا الخاصة بك من ${venue}`,
  eyebrow: "بطاقة هدايا",
  heading: "تم استخدام بطاقة هداياك",
  lead: (value) =>
    `تم استخدام بطاقة الهدايا بقيمة ${value} التي اشتريتها. نأمل أن تكون قد نالت الإعجاب.`,
  codeLabel: "رمز البطاقة",
  onLabel: (date) => `استُخدمت بتاريخ ${date}.`,
  footer: "تصلك هذه الرسالة لأنك اشتريت هذه البطاقة.",
};

export const GIFT_CARD_REDEEMED_COPY: Record<UiLocale, GiftCardRedeemedCopy> = {
  en: giftCardRedeemedEn,
  de: giftCardRedeemedDe,
  fr: giftCardRedeemedFr,
  es: giftCardRedeemedEs,
  it: giftCardRedeemedIt,
  ar: giftCardRedeemedAr,
};

export const giftCardRedeemedCopy = (locale?: string | null): GiftCardRedeemedCopy =>
  GIFT_CARD_REDEEMED_COPY[uiLocale(locale)];

/* ------------------------------------------------------------------ */
/* Delivery: "your order is on the way"                                */
/* ------------------------------------------------------------------ */

/**
 * The one status ping a delivery order sends: fired once, from
 * `dispatch-service.ts`, the moment the order flips to
 * `out_for_delivery` — a driver scanning the ticket's dispatch QR, or
 * staff tapping it on the board.
 *
 * Short on purpose. The guest already has the receipt; this mail exists
 * to say "it left, keep your phone near you", so there is no total, no
 * item list and nothing to click. The order number arrives pre-padded
 * ("0031") from the template, and each locale supplies its own way of
 * writing it (`#`, `Nr.`, `n°`, `n.º`, `n.`, `رقم`) exactly as the
 * receipt and kitchen-ticket namespaces above do.
 */
const onTheWayEn = {
  subject: (orderNumber: string) => `Your order #${orderNumber} is on the way`,
  eyebrow: "On the way",
  heading: "Your food is on its way 🛵",
  lead: (orderNumber: string) => `Order #${orderNumber} just left our kitchen.`,
  greeting: (name: string) => `Hi ${name},`,
  addressLabel: "Delivering to",
  patience:
    "It should be with you shortly. Please keep your phone nearby in case the driver needs to reach you.",
  footer: "You're getting this because you ordered from us.",
};

export type OnTheWayCopy = typeof onTheWayEn;

const onTheWayDe: OnTheWayCopy = {
  subject: (orderNumber) => `Ihre Bestellung Nr. ${orderNumber} ist unterwegs`,
  eyebrow: "Unterwegs",
  heading: "Ihr Essen ist unterwegs 🛵",
  lead: (orderNumber) => `Bestellung Nr. ${orderNumber} hat gerade unsere Küche verlassen.`,
  greeting: (name) => `Hallo ${name},`,
  addressLabel: "Lieferung an",
  patience:
    "Gleich ist es bei Ihnen. Halten Sie Ihr Telefon bitte griffbereit, falls der Fahrer Sie erreichen muss.",
  footer: "Sie erhalten diese E-Mail, weil Sie bei uns bestellt haben.",
};

const onTheWayFr: OnTheWayCopy = {
  subject: (orderNumber) => `Votre commande n° ${orderNumber} est en route`,
  eyebrow: "En route",
  heading: "Votre repas est en route 🛵",
  lead: (orderNumber) => `La commande n° ${orderNumber} vient de quitter notre cuisine.`,
  greeting: (name) => `Bonjour ${name},`,
  addressLabel: "Livraison à",
  patience:
    "Elle arrive d'un instant à l'autre. Gardez votre téléphone à portée de main, au cas où le livreur aurait besoin de vous joindre.",
  footer: "Vous recevez cet e-mail parce que vous avez commandé chez nous.",
};

const onTheWayEs: OnTheWayCopy = {
  subject: (orderNumber) => `Tu pedido n.º ${orderNumber} va en camino`,
  eyebrow: "En camino",
  heading: "Tu comida va en camino 🛵",
  lead: (orderNumber) => `El pedido n.º ${orderNumber} acaba de salir de nuestra cocina.`,
  greeting: (name) => `Hola ${name}:`,
  addressLabel: "Entrega en",
  patience: "Llegará enseguida. Ten el teléfono a mano por si el repartidor necesita localizarte.",
  footer: "Recibes este correo porque has hecho un pedido con nosotros.",
};

const onTheWayIt: OnTheWayCopy = {
  subject: (orderNumber) => `Il tuo ordine n. ${orderNumber} è in arrivo`,
  eyebrow: "In arrivo",
  heading: "Il tuo pasto è in viaggio 🛵",
  lead: (orderNumber) => `L'ordine n. ${orderNumber} ha appena lasciato la nostra cucina.`,
  greeting: (name) => `Ciao ${name},`,
  addressLabel: "Consegna a",
  patience:
    "Arriverà a momenti. Tieni il telefono a portata di mano, nel caso il fattorino debba contattarti.",
  footer: "Ricevi questa email perché hai ordinato da noi.",
};

const onTheWayAr: OnTheWayCopy = {
  subject: (orderNumber) => `طلبك رقم ${orderNumber} في الطريق إليك`,
  eyebrow: "في الطريق",
  heading: "طعامك في طريقه إليك 🛵",
  lead: (orderNumber) => `غادر الطلب رقم ${orderNumber} مطبخنا للتو.`,
  greeting: (name) => `مرحبًا ${name}،`,
  addressLabel: "التوصيل إلى",
  patience: "سيصل إليك بعد قليل. يُرجى إبقاء هاتفك قريبًا منك تحسبًا لحاجة السائق للتواصل معك.",
  footer: "تصلك هذه الرسالة لأنك طلبت منّا.",
};

export const ON_THE_WAY_COPY: Record<UiLocale, OnTheWayCopy> = {
  en: onTheWayEn,
  de: onTheWayDe,
  fr: onTheWayFr,
  es: onTheWayEs,
  it: onTheWayIt,
  ar: onTheWayAr,
};

export const onTheWayCopy = (locale?: string | null): OnTheWayCopy =>
  ON_THE_WAY_COPY[uiLocale(locale)];
