import type { UiLocale } from "@/lib/locales";
import { uiLocale } from "@/lib/locales";

/**
 * Guest copy for the two surfaces that live AFTER the order exists: the
 * tracker (`/order-status/{id}`) and the payment page (`/pay/{id}`). Both
 * are reached from a link — an email, the confirmation sheet, the app — so
 * the locale comes from `?locale=` when the link carries one and from the
 * venue's default locale otherwise (plan decision 5).
 *
 * Same shape rules as `checkout.ts`: `en` is the type, parameterised keys
 * are functions, money and times arrive pre-formatted.
 */

const en = {
  /* Tracker */
  trackTitle: "Track your order",
  orderHeading: (n: string) => `Order #${n}`,
  tableSuffix: (table: string) => ` · Table ${table}`,
  steps: {
    confirmed: "Confirmed",
    preparing: "Preparing",
    ready: "Ready",
    readyForPickup: "Ready for pickup",
    onTheWay: "On the way",
    served: "Served",
    pickedUp: "Picked up",
    delivered: "Delivered",
  },
  reward: "Reward",
  total: "Total",
  payment: "Payment",
  paidOnline: "✓ Paid online",
  paidWithReward: "✓ Paid with your reward",
  payAtRestaurant: "Pay at the restaurant",
  autoRefresh: "This page refreshes automatically every 15 seconds.",
  backToMenu: "Back to the menu",

  /* Payment page */
  net: "Net",
  vatLine: (rate: string) => `VAT ${rate}% (included)`,
  paid: "Paid ✓",
  showAtRestaurant:
    "Show this screen at the restaurant if needed — the kitchen sees the order as paid.",
  backToApp: "Back to the app",
  /* Browser sign-in hand-over (`/auth/app-return`): the guest signed in
     on a web page the app opened, and this is the whole page they see
     while the deep link takes them back. */
  signedIn: "You're signed in",
  closeWindow: "You can close this window.",
  downloadReceipt: "Download receipt (PDF)",
  /** Leading part of the downloaded file name: `receipt-0007.pdf`. ASCII
   *  only — this ends up in a Content-Disposition/`download` attribute. */
  receiptFilePrefix: "receipt",
  paused: "Ordering paused",
  pausedBody:
    "Online payments are paused right now. Please pay at the restaurant or try again later.",
  incompleteLink:
    "This payment link is incomplete — please start again from your order confirmation.",
  payAmount: (amount: string) => `Pay ${amount}`,
  processing: "Processing…",
  payFailed: "Payment didn't go through — try again.",
  testPayPage: "Test payment page — Stripe hosts this step in production",
  payWithPaypal: "Pay with PayPal",
  openingPaypal: "Opening PayPal…",
  paypalFailed: "PayPal didn't start — try again.",
  /* Reservations (the account page's "my table requests" card) */
  reservationsTitle: "My reservations",
  reservationsEmpty: "No table requests with this account yet.",
  reservationGuestsOne: "1 guest",
  reservationGuestsMany: (n: string) => `${n} guests`,
  reservationRequestedOn: (when: string) => `Requested ${when}`,
  reservationNote: "Note",
  reservationStatus: {
    requested: "Awaiting confirmation",
    confirmed: "Confirmed",
    declined: "Declined",
    cancelled: "Cancelled",
  },
  reservationHint: {
    requested: "The restaurant will call you to confirm this table.",
    confirmed: "Your table is booked — see you then.",
    declined: "The restaurant couldn't take this one. Please try another time.",
    cancelled: "This reservation was cancelled.",
  },
};

export type PostOrderCopy = typeof en;

const de: PostOrderCopy = {
  trackTitle: "Bestellung verfolgen",
  orderHeading: (n) => `Bestellung Nr. ${n}`,
  tableSuffix: (table) => ` · Tisch ${table}`,
  steps: {
    confirmed: "Bestätigt",
    preparing: "Zubereitung",
    ready: "Fertig",
    readyForPickup: "Abholbereit",
    onTheWay: "Unterwegs",
    served: "Serviert",
    pickedUp: "Abgeholt",
    delivered: "Geliefert",
  },
  reward: "Gutschein",
  total: "Gesamt",
  payment: "Zahlung",
  paidOnline: "✓ Online bezahlt",
  paidWithReward: "✓ Mit Gutschein bezahlt",
  payAtRestaurant: "Zahlung im Restaurant",
  autoRefresh: "Diese Seite aktualisiert sich automatisch alle 15 Sekunden.",
  backToMenu: "Zur Speisekarte",

  net: "Netto",
  vatLine: (rate) => `MwSt. ${rate} % (enthalten)`,
  paid: "Bezahlt ✓",
  showAtRestaurant:
    "Zeigen Sie diesen Bildschirm bei Bedarf im Restaurant vor — die Küche sieht die Bestellung als bezahlt.",
  backToApp: "Zurück zur App",
  signedIn: "Sie sind angemeldet",
  closeWindow: "Sie können dieses Fenster schließen.",
  downloadReceipt: "Beleg herunterladen (PDF)",
  receiptFilePrefix: "beleg",
  paused: "Bestellungen pausiert",
  pausedBody:
    "Online-Zahlungen sind gerade pausiert. Bitte zahlen Sie im Restaurant oder versuchen Sie es später erneut.",
  incompleteLink:
    "Dieser Zahlungslink ist unvollständig — bitte starten Sie erneut über Ihre Bestellbestätigung.",
  payAmount: (amount) => `${amount} bezahlen`,
  processing: "Wird verarbeitet…",
  payFailed: "Die Zahlung ist nicht durchgegangen — bitte erneut versuchen.",
  testPayPage: "Test-Zahlungsseite — in der Produktion übernimmt Stripe diesen Schritt",
  payWithPaypal: "Mit PayPal zahlen",
  openingPaypal: "PayPal wird geöffnet…",
  paypalFailed: "PayPal wurde nicht gestartet — bitte erneut versuchen.",
  reservationsTitle: "Meine Reservierungen",
  reservationsEmpty: "Noch keine Tischanfragen mit diesem Konto.",
  reservationGuestsOne: "1 Gast",
  reservationGuestsMany: (n) => `${n} Gäste`,
  reservationRequestedOn: (when) => `Angefragt am ${when}`,
  reservationNote: "Hinweis",
  reservationStatus: {
    requested: "Warten auf Bestätigung",
    confirmed: "Bestätigt",
    declined: "Abgelehnt",
    cancelled: "Storniert",
  },
  reservationHint: {
    requested: "Das Restaurant meldet sich telefonisch zur Bestätigung.",
    confirmed: "Ihr Tisch ist reserviert — bis dann.",
    declined:
      "Das Restaurant konnte diesen Termin nicht annehmen. Bitte wählen Sie eine andere Zeit.",
    cancelled: "Diese Reservierung wurde storniert.",
  },
};

const es: PostOrderCopy = {
  trackTitle: "Seguimiento del pedido",
  orderHeading: (n) => `Pedido n.º ${n}`,
  tableSuffix: (table) => ` · Mesa ${table}`,
  steps: {
    confirmed: "Confirmado",
    preparing: "En preparación",
    ready: "Listo",
    readyForPickup: "Listo para recoger",
    onTheWay: "En camino",
    served: "Servido",
    pickedUp: "Recogido",
    delivered: "Entregado",
  },
  reward: "Vale",
  total: "Total",
  payment: "Pago",
  paidOnline: "✓ Pagado online",
  paidWithReward: "✓ Pagado con tu vale",
  payAtRestaurant: "Pago en el restaurante",
  autoRefresh: "Esta página se actualiza automáticamente cada 15 segundos.",
  backToMenu: "Volver a la carta",

  net: "Base imponible",
  vatLine: (rate) => `IVA ${rate} % (incluido)`,
  paid: "Pagado ✓",
  showAtRestaurant:
    "Muestra esta pantalla en el restaurante si hace falta: la cocina ve el pedido como pagado.",
  backToApp: "Volver a la app",
  signedIn: "Has iniciado sesión",
  closeWindow: "Ya puedes cerrar esta ventana.",
  downloadReceipt: "Descargar el recibo (PDF)",
  receiptFilePrefix: "recibo",
  paused: "Pedidos en pausa",
  pausedBody:
    "Los pagos online están en pausa. Paga en el restaurante o inténtalo de nuevo más tarde.",
  incompleteLink:
    "Este enlace de pago está incompleto: vuelve a empezar desde la confirmación de tu pedido.",
  payAmount: (amount) => `Pagar ${amount}`,
  processing: "Procesando…",
  payFailed: "El pago no se ha completado: inténtalo de nuevo.",
  testPayPage: "Página de pago de prueba: en producción este paso lo aloja Stripe",
  payWithPaypal: "Pagar con PayPal",
  openingPaypal: "Abriendo PayPal…",
  paypalFailed: "PayPal no se ha iniciado: inténtalo de nuevo.",
  reservationsTitle: "Mis reservas",
  reservationsEmpty: "Todavía no hay reservas con esta cuenta.",
  reservationGuestsOne: "1 persona",
  reservationGuestsMany: (n) => `${n} personas`,
  reservationRequestedOn: (when) => `Solicitada el ${when}`,
  reservationNote: "Nota",
  reservationStatus: {
    requested: "Pendiente de confirmación",
    confirmed: "Confirmada",
    declined: "Rechazada",
    cancelled: "Cancelada",
  },
  reservationHint: {
    requested: "El restaurante te llamará para confirmar la mesa.",
    confirmed: "Tu mesa está reservada: nos vemos.",
    declined: "El restaurante no ha podido aceptarla. Prueba con otra hora.",
    cancelled: "Esta reserva se ha cancelado.",
  },
};

const it: PostOrderCopy = {
  trackTitle: "Segui il tuo ordine",
  orderHeading: (n) => `Ordine n. ${n}`,
  tableSuffix: (table) => ` · Tavolo ${table}`,
  steps: {
    confirmed: "Confermato",
    preparing: "In preparazione",
    ready: "Pronto",
    readyForPickup: "Pronto per il ritiro",
    onTheWay: "In arrivo",
    served: "Servito",
    pickedUp: "Ritirato",
    delivered: "Consegnato",
  },
  reward: "Buono",
  total: "Totale",
  payment: "Pagamento",
  paidOnline: "✓ Pagato online",
  paidWithReward: "✓ Pagato con il tuo buono",
  payAtRestaurant: "Pagamento al ristorante",
  autoRefresh: "Questa pagina si aggiorna automaticamente ogni 15 secondi.",
  backToMenu: "Torna al menu",

  net: "Imponibile",
  vatLine: (rate) => `IVA ${rate}% (inclusa)`,
  paid: "Pagato ✓",
  showAtRestaurant:
    "Mostra questa schermata al ristorante se serve: la cucina vede l'ordine come pagato.",
  backToApp: "Torna all'app",
  signedIn: "Accesso effettuato",
  closeWindow: "Puoi chiudere questa finestra.",
  downloadReceipt: "Scarica la ricevuta (PDF)",
  receiptFilePrefix: "ricevuta",
  paused: "Ordini in pausa",
  pausedBody: "I pagamenti online sono in pausa. Paga al ristorante o riprova più tardi.",
  incompleteLink: "Questo link di pagamento è incompleto: riparti dalla conferma del tuo ordine.",
  payAmount: (amount) => `Paga ${amount}`,
  processing: "Elaborazione…",
  payFailed: "Il pagamento non è andato a buon fine: riprova.",
  testPayPage: "Pagina di pagamento di prova: in produzione questo passaggio è ospitato da Stripe",
  payWithPaypal: "Paga con PayPal",
  openingPaypal: "Apertura di PayPal…",
  paypalFailed: "PayPal non è partito: riprova.",
  reservationsTitle: "Le mie prenotazioni",
  reservationsEmpty: "Ancora nessuna prenotazione con questo account.",
  reservationGuestsOne: "1 persona",
  reservationGuestsMany: (n) => `${n} persone`,
  reservationRequestedOn: (when) => `Richiesta il ${when}`,
  reservationNote: "Nota",
  reservationStatus: {
    requested: "In attesa di conferma",
    confirmed: "Confermata",
    declined: "Rifiutata",
    cancelled: "Annullata",
  },
  reservationHint: {
    requested: "Il ristorante ti chiamerà per confermare il tavolo.",
    confirmed: "Il tuo tavolo è prenotato: a presto.",
    declined: "Il ristorante non ha potuto accettarla. Prova con un altro orario.",
    cancelled: "Questa prenotazione è stata annullata.",
  },
};

const ar: PostOrderCopy = {
  trackTitle: "تتبّع الطلب",
  orderHeading: (n) => `الطلب رقم ${n}`,
  tableSuffix: (table) => ` · طاولة ${table}`,
  steps: {
    confirmed: "مؤكَّد",
    preparing: "قيد التحضير",
    ready: "جاهز",
    readyForPickup: "جاهز للاستلام",
    onTheWay: "في الطريق",
    served: "تم التقديم",
    pickedUp: "تم الاستلام",
    delivered: "تم التوصيل",
  },
  reward: "قسيمة",
  total: "الإجمالي",
  payment: "الدفع",
  paidOnline: "✓ مدفوع عبر الإنترنت",
  paidWithReward: "✓ مدفوع بقسيمة المكافأة",
  payAtRestaurant: "الدفع في المطعم",
  autoRefresh: "تُحدَّث هذه الصفحة تلقائيًا كل 15 ثانية.",
  backToMenu: "العودة إلى قائمة الطعام",

  net: "الصافي",
  vatLine: (rate) => `ضريبة القيمة المضافة ${rate}% (مشمولة)`,
  paid: "تم الدفع ✓",
  showAtRestaurant: "اعرض هذه الشاشة في المطعم عند الحاجة — يرى المطبخ الطلب مدفوعًا.",
  backToApp: "العودة إلى التطبيق",
  signedIn: "تم تسجيل الدخول",
  closeWindow: "يمكنك إغلاق هذه النافذة.",
  downloadReceipt: "تنزيل الإيصال (PDF)",
  // ASCII on purpose: this lands in a file name.
  receiptFilePrefix: "receipt",
  paused: "الطلبات متوقفة مؤقتًا",
  pausedBody: "الدفع عبر الإنترنت متوقف مؤقتًا. يُرجى الدفع في المطعم أو المحاولة لاحقًا.",
  incompleteLink: "رابط الدفع هذا غير مكتمل — يُرجى البدء من جديد من تأكيد طلبك.",
  payAmount: (amount) => `ادفع ${amount}`,
  processing: "جارٍ المعالجة…",
  payFailed: "لم يتم الدفع — حاول مرة أخرى.",
  testPayPage: "صفحة دفع تجريبية — في بيئة الإنتاج تستضيف Stripe هذه الخطوة",
  payWithPaypal: "الدفع عبر PayPal",
  openingPaypal: "جارٍ فتح PayPal…",
  paypalFailed: "لم يبدأ PayPal — حاول مرة أخرى.",
  reservationsTitle: "حجوزاتي",
  reservationsEmpty: "لا توجد حجوزات بهذا الحساب بعد.",
  reservationGuestsOne: "شخص واحد",
  reservationGuestsMany: (n) => `${n} أشخاص`,
  reservationRequestedOn: (when) => `تم الطلب في ${when}`,
  reservationNote: "ملاحظة",
  reservationStatus: {
    requested: "في انتظار التأكيد",
    confirmed: "مؤكد",
    declined: "مرفوض",
    cancelled: "ملغى",
  },
  reservationHint: {
    requested: "سيتصل بك المطعم لتأكيد الطاولة.",
    confirmed: "تم حجز طاولتك — نراك قريبًا.",
    declined: "لم يتمكن المطعم من قبول هذا الموعد. جرّب وقتًا آخر.",
    cancelled: "تم إلغاء هذا الحجز.",
  },
};

export const POST_ORDER_COPY: Record<UiLocale, PostOrderCopy> = { en, de, es, it, ar };

/** Post-order copy for a venue/route locale (region tags collapse, unknown
 *  codes fall back to English). */
export const postOrderCopy = (locale?: string | null): PostOrderCopy =>
  POST_ORDER_COPY[uiLocale(locale)];
