import type { UiLocale } from "@/lib/locales";
import { uiLocale } from "@/lib/locales";

/**
 * The gift-card SHARE page (`/gift-cards/{code}?t=…`) — the page a buyer
 * forwards to whoever they are gifting.
 *
 * The reader here is NOT our customer: they have never seen this
 * restaurant's app, they arrived from a WhatsApp message, and the first
 * question in their head is "can I still use this?". So the status words
 * are blunt and the how-to line is one sentence.
 *
 * Same shape rules as `post-order.ts`: `en` is the type, parameterised
 * keys are functions, and money and dates arrive pre-formatted from the
 * page — nothing here does `Intl` work of its own.
 *
 * German note: a gift card is a **Geschenkgutschein**, never a bare
 * "Gutschein" — that word is already the loyalty voucher elsewhere in the
 * product, and a guest holding both must be able to tell them apart.
 */

const en = {
  title: "Gift card",
  lead: "Someone has given you this gift card. Show it at the restaurant, or enter the code when you order in the app.",
  valueLabel: "Value",
  codeLabel: "Card code",
  forLabel: (name: string) => `For ${name}`,
  messageLabel: "Their message",
  howTo:
    "When you pay, show this screen or read the code out. It is used once, for its full value.",
  expiry: (date: string) => `Valid until ${date}.`,

  /* Status. `statusActive` is the reassuring one; the other three have to
     be unmistakable at a glance, because they are the answer to the only
     question that matters. */
  statusActive: "Ready to use",
  redeemed: "This gift card has already been used",
  redeemedBody: "Its full value has been spent, so it cannot be used again.",
  expired: "This gift card has expired",
  expiredBody:
    "It is past its validity date and can no longer be used. Please ask the restaurant if anything is unclear.",
  refunded: "This gift card was refunded",
  refundedBody: "The purchase was paid back, so the card can no longer be used.",

  /* Timeline: bought → link opened → redeemed. */
  timelineTitle: "What happened so far",
  timelineBought: "Bought",
  timelineShared: "Link opened",
  timelineRedeemedCounter: "Redeemed at the restaurant",
  timelineRedeemedOrder: (number: string) => `Redeemed on order #${number}`,

  legal: "This is a multi-purpose voucher. It cannot be exchanged for cash.",
  qrAlt: "QR code for this gift card",
  imageAlt: "Gift card design",
  backToMenu: "Back to the menu",
};

export type GiftCardPageCopy = typeof en;

const de: GiftCardPageCopy = {
  title: "Geschenkgutschein",
  lead: "Jemand hat Ihnen diesen Geschenkgutschein geschenkt. Zeigen Sie ihn im Restaurant vor oder geben Sie den Code beim Bestellen in der App ein.",
  valueLabel: "Wert",
  codeLabel: "Geschenkgutschein-Code",
  forLabel: (name) => `Für ${name}`,
  messageLabel: "Die Nachricht dazu",
  howTo:
    "Zeigen Sie beim Bezahlen diesen Bildschirm vor oder lesen Sie den Code vor. Der Geschenkgutschein wird einmal eingelöst, über den vollen Wert.",
  expiry: (date) => `Gültig bis ${date}.`,

  statusActive: "Einlösbar",
  redeemed: "Dieser Geschenkgutschein wurde bereits eingelöst",
  redeemedBody: "Sein voller Wert ist verbraucht — er kann kein zweites Mal eingelöst werden.",
  expired: "Dieser Geschenkgutschein ist abgelaufen",
  expiredBody:
    "Das Gültigkeitsdatum ist überschritten, er kann nicht mehr eingelöst werden. Bei Fragen wenden Sie sich bitte an das Restaurant.",
  refunded: "Dieser Geschenkgutschein wurde erstattet",
  refundedBody:
    "Der Kaufbetrag wurde zurückgezahlt, deshalb ist der Geschenkgutschein nicht mehr einlösbar.",

  timelineTitle: "Bisher passiert",
  timelineBought: "Gekauft",
  timelineShared: "Link geöffnet",
  timelineRedeemedCounter: "Im Restaurant eingelöst",
  timelineRedeemedOrder: (number) => `Eingelöst bei Bestellung Nr. ${number}`,

  legal: "Dies ist ein Mehrzweckgutschein. Eine Barauszahlung ist ausgeschlossen.",
  qrAlt: "QR-Code für diesen Geschenkgutschein",
  imageAlt: "Motiv des Geschenkgutscheins",
  backToMenu: "Zur Speisekarte",
};

/** French addresses the reader formally ("vous"), and wants a plain space
 *  before « : ; ! ? » — the same rule as the neighbouring catalogues. */
const fr: GiftCardPageCopy = {
  title: "Carte cadeau",
  lead: "Quelqu'un vous offre cette carte cadeau. Présentez-la au restaurant, ou saisissez le code au moment de commander dans l'application.",
  valueLabel: "Valeur",
  codeLabel: "Code de la carte",
  forLabel: (name) => `Pour ${name}`,
  messageLabel: "Le message qui l'accompagne",
  howTo:
    "Au moment de payer, montrez cet écran ou dictez le code. La carte s'utilise une seule fois, pour la totalité de son montant.",
  expiry: (date) => `Valable jusqu'au ${date}.`,

  statusActive: "Utilisable",
  redeemed: "Cette carte cadeau a déjà été utilisée",
  redeemedBody: "La totalité de son montant a été dépensée : elle ne peut plus servir.",
  expired: "Cette carte cadeau a expiré",
  expiredBody:
    "Sa date de validité est passée : elle ne peut plus être utilisée. Contactez le restaurant si quelque chose n'est pas clair.",
  refunded: "Cette carte cadeau a été remboursée",
  refundedBody: "L'achat a été remboursé, la carte n'est donc plus utilisable.",

  timelineTitle: "Ce qui s'est passé",
  timelineBought: "Achetée",
  timelineShared: "Lien ouvert",
  timelineRedeemedCounter: "Utilisée au restaurant",
  timelineRedeemedOrder: (number) => `Utilisée sur la commande n° ${number}`,

  legal: "Il s'agit d'un bon à usages multiples. Il ne peut pas être échangé contre des espèces.",
  qrAlt: "QR code de cette carte cadeau",
  imageAlt: "Visuel de la carte cadeau",
  backToMenu: "Retour à la carte",
};

const es: GiftCardPageCopy = {
  title: "Tarjeta regalo",
  lead: "Alguien te regala esta tarjeta. Muéstrala en el restaurante o introduce el código al hacer tu pedido en la app.",
  valueLabel: "Valor",
  codeLabel: "Código de la tarjeta",
  forLabel: (name) => `Para ${name}`,
  messageLabel: "El mensaje que la acompaña",
  howTo:
    "Al pagar, enseña esta pantalla o di el código en voz alta. La tarjeta se canjea una sola vez, por su valor completo.",
  expiry: (date) => `Válida hasta el ${date}.`,

  statusActive: "Lista para usar",
  redeemed: "Esta tarjeta regalo ya se ha canjeado",
  redeemedBody: "Se ha gastado su valor completo, así que no puede volver a usarse.",
  expired: "Esta tarjeta regalo ha caducado",
  expiredBody:
    "Ha pasado su fecha de validez y ya no se puede usar. Pregunta en el restaurante si tienes cualquier duda.",
  refunded: "Esta tarjeta regalo se ha reembolsado",
  refundedBody: "Se devolvió el importe de la compra, así que la tarjeta ya no se puede usar.",

  timelineTitle: "Lo que ha pasado",
  timelineBought: "Comprada",
  timelineShared: "Enlace abierto",
  timelineRedeemedCounter: "Canjeada en el restaurante",
  timelineRedeemedOrder: (number) => `Canjeada en el pedido n.º ${number}`,

  legal: "Es un bono polivalente. No se puede canjear por dinero en efectivo.",
  qrAlt: "Código QR de esta tarjeta regalo",
  imageAlt: "Diseño de la tarjeta regalo",
  backToMenu: "Volver a la carta",
};

const it: GiftCardPageCopy = {
  title: "Carta regalo",
  lead: "Qualcuno ti ha regalato questa carta. Mostrala al ristorante oppure inserisci il codice quando ordini nell'app.",
  valueLabel: "Valore",
  codeLabel: "Codice della carta",
  forLabel: (name) => `Per ${name}`,
  messageLabel: "Il messaggio che l'accompagna",
  howTo:
    "Al momento di pagare mostra questa schermata oppure detta il codice. La carta si usa una sola volta, per l'intero valore.",
  expiry: (date) => `Valida fino al ${date}.`,

  statusActive: "Pronta da usare",
  redeemed: "Questa carta regalo è già stata utilizzata",
  redeemedBody: "Il suo intero valore è stato speso: non può essere usata di nuovo.",
  expired: "Questa carta regalo è scaduta",
  expiredBody:
    "La data di validità è passata e non può più essere utilizzata. Chiedi al ristorante se qualcosa non ti è chiaro.",
  refunded: "Questa carta regalo è stata rimborsata",
  refundedBody:
    "L'importo dell'acquisto è stato restituito, quindi la carta non è più utilizzabile.",

  timelineTitle: "Che cosa è successo",
  timelineBought: "Acquistata",
  timelineShared: "Link aperto",
  timelineRedeemedCounter: "Utilizzata al ristorante",
  timelineRedeemedOrder: (number) => `Utilizzata sull'ordine n. ${number}`,

  legal: "È un buono multiuso. Non è convertibile in denaro contante.",
  qrAlt: "Codice QR di questa carta regalo",
  imageAlt: "Grafica della carta regalo",
  backToMenu: "Torna al menu",
};

const ar: GiftCardPageCopy = {
  title: "بطاقة هدايا",
  lead: "أهداك أحدهم هذه البطاقة. اعرضها في المطعم أو أدخل الرمز عند الطلب من التطبيق.",
  valueLabel: "القيمة",
  codeLabel: "رمز البطاقة",
  forLabel: (name) => `إلى ${name}`,
  messageLabel: "الرسالة المرفقة",
  howTo:
    "عند الدفع اعرض هذه الشاشة أو اقرأ الرمز بصوت واضح. تُستخدم البطاقة مرة واحدة، بكامل قيمتها.",
  expiry: (date) => `صالحة حتى ${date}.`,

  statusActive: "جاهزة للاستخدام",
  redeemed: "تم استخدام هذه البطاقة بالفعل",
  redeemedBody: "استُهلكت قيمتها بالكامل، ولا يمكن استخدامها مرة أخرى.",
  expired: "انتهت صلاحية هذه البطاقة",
  expiredBody:
    "تجاوزت تاريخ صلاحيتها ولم تعد قابلة للاستخدام. يُرجى سؤال المطعم إذا كان هناك أي غموض.",
  refunded: "تم ردّ قيمة هذه البطاقة",
  refundedBody: "أُعيد مبلغ الشراء، لذلك لم تعد البطاقة قابلة للاستخدام.",

  timelineTitle: "ما حدث حتى الآن",
  timelineBought: "تم الشراء",
  timelineShared: "تم فتح الرابط",
  timelineRedeemedCounter: "استُخدمت في المطعم",
  timelineRedeemedOrder: (number) => `استُخدمت في الطلب رقم ${number}`,

  legal: "هذه قسيمة متعددة الأغراض. لا يمكن استبدالها نقدًا.",
  qrAlt: "رمز QR لهذه البطاقة",
  imageAlt: "تصميم بطاقة الهدايا",
  backToMenu: "العودة إلى قائمة الطعام",
};

export const GIFT_CARD_PAGE_COPY: Record<UiLocale, GiftCardPageCopy> = { de, en, fr, es, it, ar };

/** Share-page copy for a venue/route locale (region tags collapse, unknown
 *  codes fall back to English). */
export const giftCardPageCopy = (locale?: string | null): GiftCardPageCopy =>
  GIFT_CARD_PAGE_COPY[uiLocale(locale)];
