import type { UiLocale } from "@/lib/locales";
import { uiLocale } from "@/lib/locales";

/**
 * Guest copy for everything from "open the cart" to "order placed": the
 * cart drawer and the Add button on every dish card.
 *
 * No i18n runtime (CLAUDE.md): one plain object per locale, `en` is the
 * shape, so TypeScript fails the build the moment a locale misses a key.
 * Parameterised strings are functions rather than templates with
 * positional markers — the translator moves the value where the sentence
 * needs it, which is the whole point in `ar`.
 *
 * Money is always pre-formatted by the caller (`formatCents`), so these
 * strings never see cents or a currency code.
 */

const en = {
  /* Floating bar + sheet chrome */
  yourOrder: "Your order",
  placedBadge: (n: string) => `Order #${n} ✓`,
  headingPlaced: (n: string) => `Order #${n}`,
  close: "Close order panel",

  /* Line items */
  each: (price: string) => `${price} each`,
  oneLess: (name: string) => `One less ${name}`,
  oneMore: (name: string) => `One more ${name}`,
  removeLine: (name: string) => `Remove ${name} from the order`,
  remove: "Remove",
  total: "Total",
  vatIncluded: (rate: string, amount: string) => `incl. ${rate}% VAT ${amount}`,
  /* Loyalty — one line under the total; shown only when the restaurant
     collects points and this basket already qualifies. */
  loyaltyEarn: (points: string) => `You'll earn ${points} points with this order`,
  loyaltySignIn: (points: string) => `Sign in to earn ${points} points on this order`,
  clearCart: "Clear cart",
  addItems: "Add items",

  /* Order type */
  orderTypeGroup: "Order type",
  dineIn: "Dine-in",
  takeaway: "Pickup",
  delivery: "Delivery",

  /* Fields */
  tableNumber: "Table number (optional)",
  tableNumberPlaceholder: "e.g. 12",
  yourName: "Your name",
  phone: "Phone number",
  phonePlaceholder: "+49 …",
  deliveryTime: "Delivery time",
  pickupTime: "Pickup time",
  asap: "As soon as possible",
  email: "Email (optional) — we'll send your receipt",
  emailPlaceholder: "you@example.com",
  street: "Street and house number",
  zip: "ZIP",
  selectPlaceholder: "Select…",
  city: "City / Community / Village",
  cityPlaceholder: "— select your ZIP —",
  deliveryNote: "Delivery note (optional)",
  deliveryNotePlaceholder: "e.g. ring twice, 3rd floor",

  /* Delivery economics */
  freeDeliveryHere: "Free delivery to this area 🎉",
  freeDeliveryFrom: (amount: string) => `Free delivery from ${amount}`,
  deliveryFee: (fee: string) => `Delivery fee ${fee}`,
  minimumOrderSuffix: (min: string) => ` · minimum order ${min}`,
  minimumOrder: (min: string) => `Minimum order ${min}`,
  belowMinimum: (min: string, missing: string) =>
    `Delivery starts at ${min} — add ${missing} more.`,

  /* Pay row */
  payGroup: "Place order and pay",
  pay: "Pay",
  placeOrder: "Place order",
  card: "Card",
  paypal: "PayPal",
  payAtTable: "Pay at table",
  payAtPickup: "Pay at pickup",
  cashToDriver: "Cash to driver",
  placing: "Placing…",
  opening: "Opening…",
  explainerOnline:
    "Card and PayPal open a secure payment page once your order is saved; nothing is charged before you confirm there. Your receipt downloads automatically afterwards.",
  explainerDelivery: "No payment online — you pay the driver.",
  explainerPickup: "No payment online — you pay at pickup.",
  explainerDineIn: "No payment now — you pay at the restaurant.",
  weAccept: "We accept",

  /* Confirmation */
  placedIntro: "Your order is in — the staff sees it as",
  placedRef: (n: string) => `order #${n}`,
  placedForTable: (table: string) => ` for table ${table}`,
  placedCashTail: ", payable at the restaurant. Your receipt is downloading.",
  placedEmailTail: (email: string, pending: boolean) =>
    ` We'll email your receipt to ${email}${pending ? " once the payment is confirmed" : ""}.`,
  payOnline: (amount: string) => `Pay online · ${amount}`,
  openingPayment: "Opening payment…",
  openingPaypal: "Opening PayPal…",
  payWithPaypal: "Pay with PayPal",
  trackOrder: "Track your order",
  downloadReceipt: "Download receipt (PDF)",
  startNewOrder: "Start a new order",

  /* Errors — one per failure the server can report, plus the two network ones */
  errPaypalOpen:
    "PayPal couldn't be opened — your order is saved; try the PayPal button below or pay at the restaurant.",
  errCardOpen:
    "Card payment couldn't be opened — your order is saved; try the button below or pay at the restaurant.",
  errPayRetry: "No connection — your order is saved; try paying again below.",
  errUnknownItems:
    "The menu changed while you were ordering. Please review your items and try again.",
  errRateLimited: "Too many orders from this connection — please wait a minute.",
  errTypeNotAvailable: "This order type just went offline — pick another option.",
  errOutsideArea: "Sorry, that address is outside the delivery area.",
  errBelowMinimum: (min: string) => `Delivery starts at ${min} — add a little more.`,
  errInvalidTime: "That time just passed or is outside opening hours — pick another.",
  errGeneric: "The order didn't go through. Please try again.",
  errNoConnection: "No connection — check your network and try again.",

  /* Add button on the dish card */
  add: "+ Add",
  added: "Added ✓",
  addAria: (name: string) => `Add ${name} to order`,
};

export type CheckoutCopy = typeof en;

const de: CheckoutCopy = {
  yourOrder: "Ihre Bestellung",
  placedBadge: (n) => `Bestellung Nr. ${n} ✓`,
  headingPlaced: (n) => `Bestellung Nr. ${n}`,
  close: "Bestellfenster schließen",

  each: (price) => `${price} pro Stück`,
  oneLess: (name) => `Ein ${name} weniger`,
  oneMore: (name) => `Ein ${name} mehr`,
  removeLine: (name) => `${name} aus der Bestellung entfernen`,
  remove: "Entfernen",
  total: "Gesamt",
  vatIncluded: (rate, amount) => `inkl. ${rate} % MwSt. ${amount}`,
  loyaltyEarn: (points) => `Sie sammeln ${points} Punkte mit dieser Bestellung`,
  loyaltySignIn: (points) => `Anmelden und ${points} Punkte für diese Bestellung sammeln`,
  clearCart: "Bestellung leeren",
  addItems: "Weitere Artikel",

  orderTypeGroup: "Bestellart",
  dineIn: "Im Restaurant",
  takeaway: "Abholung",
  delivery: "Lieferung",

  tableNumber: "Tischnummer (optional)",
  tableNumberPlaceholder: "z. B. 12",
  yourName: "Ihr Name",
  phone: "Telefonnummer",
  phonePlaceholder: "+49 …",
  deliveryTime: "Lieferzeit",
  pickupTime: "Abholzeit",
  asap: "So bald wie möglich",
  email: "E-Mail (optional) — wir senden Ihnen den Beleg",
  emailPlaceholder: "sie@beispiel.de",
  street: "Straße und Hausnummer",
  zip: "PLZ",
  selectPlaceholder: "Auswählen…",
  city: "Stadt / Gemeinde / Ort",
  cityPlaceholder: "— PLZ auswählen —",
  deliveryNote: "Hinweis zur Lieferung (optional)",
  deliveryNotePlaceholder: "z. B. zweimal klingeln, 3. Stock",

  freeDeliveryHere: "Kostenlose Lieferung in dieses Gebiet 🎉",
  freeDeliveryFrom: (amount) => `Kostenlose Lieferung ab ${amount}`,
  deliveryFee: (fee) => `Liefergebühr ${fee}`,
  minimumOrderSuffix: (min) => ` · Mindestbestellwert ${min}`,
  minimumOrder: (min) => `Mindestbestellwert ${min}`,
  belowMinimum: (min, missing) => `Lieferung ab ${min} — es fehlen noch ${missing}.`,

  payGroup: "Bestellen und bezahlen",
  pay: "Bezahlen",
  placeOrder: "Bestellen",
  card: "Karte",
  paypal: "PayPal",
  payAtTable: "Am Tisch zahlen",
  payAtPickup: "Bei Abholung zahlen",
  cashToDriver: "Bar an den Fahrer",
  placing: "Wird gesendet…",
  opening: "Wird geöffnet…",
  explainerOnline:
    "Karte und PayPal öffnen eine sichere Zahlungsseite, sobald Ihre Bestellung gespeichert ist; abgebucht wird erst, wenn Sie dort bestätigen. Ihr Beleg wird danach automatisch heruntergeladen.",
  explainerDelivery: "Keine Onlinezahlung — Sie zahlen beim Fahrer.",
  explainerPickup: "Keine Onlinezahlung — Sie zahlen bei der Abholung.",
  explainerDineIn: "Keine Zahlung jetzt — Sie zahlen im Restaurant.",
  weAccept: "Wir akzeptieren",

  placedIntro: "Ihre Bestellung ist eingegangen — das Team sieht sie als",
  placedRef: (n) => `Bestellung Nr. ${n}`,
  placedForTable: (table) => ` für Tisch ${table}`,
  placedCashTail: ", zahlbar im Restaurant. Ihr Beleg wird heruntergeladen.",
  placedEmailTail: (email, pending) =>
    ` Wir senden Ihren Beleg an ${email}${pending ? ", sobald die Zahlung bestätigt ist" : ""}.`,
  payOnline: (amount) => `Online bezahlen · ${amount}`,
  openingPayment: "Zahlung wird geöffnet…",
  openingPaypal: "PayPal wird geöffnet…",
  payWithPaypal: "Mit PayPal zahlen",
  trackOrder: "Bestellung verfolgen",
  downloadReceipt: "Beleg herunterladen (PDF)",
  startNewOrder: "Neue Bestellung starten",

  errPaypalOpen:
    "PayPal konnte nicht geöffnet werden — Ihre Bestellung ist gespeichert; versuchen Sie es unten erneut oder zahlen Sie im Restaurant.",
  errCardOpen:
    "Die Kartenzahlung konnte nicht geöffnet werden — Ihre Bestellung ist gespeichert; versuchen Sie es unten erneut oder zahlen Sie im Restaurant.",
  errPayRetry:
    "Keine Verbindung — Ihre Bestellung ist gespeichert; versuchen Sie die Zahlung unten erneut.",
  errUnknownItems:
    "Die Speisekarte hat sich während der Bestellung geändert. Bitte prüfen Sie Ihre Artikel und versuchen Sie es erneut.",
  errRateLimited: "Zu viele Bestellungen von dieser Verbindung — bitte warten Sie eine Minute.",
  errTypeNotAvailable:
    "Diese Bestellart ist gerade nicht mehr verfügbar — bitte wählen Sie eine andere.",
  errOutsideArea: "Diese Adresse liegt leider außerhalb des Liefergebiets.",
  errBelowMinimum: (min) => `Lieferung ab ${min} — bitte legen Sie noch etwas dazu.`,
  errInvalidTime:
    "Diese Zeit ist gerade vorbei oder liegt außerhalb der Öffnungszeiten — bitte wählen Sie eine andere.",
  errGeneric: "Die Bestellung ist nicht durchgegangen. Bitte versuchen Sie es erneut.",
  errNoConnection: "Keine Verbindung — bitte prüfen Sie Ihr Netzwerk und versuchen Sie es erneut.",

  add: "+ Hinzufügen",
  added: "Hinzugefügt ✓",
  addAria: (name) => `${name} zur Bestellung hinzufügen`,
};

const es: CheckoutCopy = {
  yourOrder: "Tu pedido",
  placedBadge: (n) => `Pedido n.º ${n} ✓`,
  headingPlaced: (n) => `Pedido n.º ${n}`,
  close: "Cerrar el panel del pedido",

  each: (price) => `${price} cada uno`,
  oneLess: (name) => `Uno menos de ${name}`,
  oneMore: (name) => `Uno más de ${name}`,
  removeLine: (name) => `Quitar ${name} del pedido`,
  remove: "Quitar",
  total: "Total",
  vatIncluded: (rate, amount) => `IVA ${rate} % incluido ${amount}`,
  loyaltyEarn: (points) => `Ganarás ${points} puntos con este pedido`,
  loyaltySignIn: (points) => `Inicia sesión y gana ${points} puntos con este pedido`,
  clearCart: "Vaciar el pedido",
  addItems: "Añadir platos",

  orderTypeGroup: "Tipo de pedido",
  dineIn: "En el local",
  takeaway: "Recogida",
  delivery: "Entrega",

  tableNumber: "Número de mesa (opcional)",
  tableNumberPlaceholder: "p. ej. 12",
  yourName: "Tu nombre",
  phone: "Teléfono",
  phonePlaceholder: "+34 …",
  deliveryTime: "Hora de entrega",
  pickupTime: "Hora de recogida",
  asap: "Lo antes posible",
  email: "Correo electrónico (opcional): te enviaremos el recibo",
  emailPlaceholder: "tu@ejemplo.com",
  street: "Calle y número",
  zip: "C. P.",
  selectPlaceholder: "Selecciona…",
  city: "Ciudad / Municipio / Pueblo",
  cityPlaceholder: "— selecciona tu código postal —",
  deliveryNote: "Nota para la entrega (opcional)",
  deliveryNotePlaceholder: "p. ej. llamar dos veces, 3.º piso",

  freeDeliveryHere: "Entrega gratuita en esta zona 🎉",
  freeDeliveryFrom: (amount) => `Entrega gratuita a partir de ${amount}`,
  deliveryFee: (fee) => `Gastos de entrega ${fee}`,
  minimumOrderSuffix: (min) => ` · pedido mínimo ${min}`,
  minimumOrder: (min) => `Pedido mínimo ${min}`,
  belowMinimum: (min, missing) => `La entrega empieza en ${min}: faltan ${missing}.`,

  payGroup: "Hacer el pedido y pagar",
  pay: "Pagar",
  placeOrder: "Hacer el pedido",
  card: "Tarjeta",
  paypal: "PayPal",
  payAtTable: "Pagar en la mesa",
  payAtPickup: "Pagar al recoger",
  cashToDriver: "Efectivo al repartidor",
  placing: "Enviando…",
  opening: "Abriendo…",
  explainerOnline:
    "Con tarjeta o PayPal se abre una página de pago segura en cuanto se guarda tu pedido; no se cobra nada hasta que lo confirmes allí. Después, el recibo se descarga automáticamente.",
  explainerDelivery: "Sin pago online: pagas al repartidor.",
  explainerPickup: "Sin pago online: pagas al recoger.",
  explainerDineIn: "Ahora no se paga: pagas en el restaurante.",
  weAccept: "Aceptamos",

  placedIntro: "Tu pedido ha llegado: el personal lo ve como",
  placedRef: (n) => `pedido n.º ${n}`,
  placedForTable: (table) => ` para la mesa ${table}`,
  placedCashTail: ", a pagar en el restaurante. Tu recibo se está descargando.",
  placedEmailTail: (email, pending) =>
    ` Enviaremos tu recibo a ${email}${pending ? " en cuanto se confirme el pago" : ""}.`,
  payOnline: (amount) => `Pagar online · ${amount}`,
  openingPayment: "Abriendo el pago…",
  openingPaypal: "Abriendo PayPal…",
  payWithPaypal: "Pagar con PayPal",
  trackOrder: "Seguir tu pedido",
  downloadReceipt: "Descargar el recibo (PDF)",
  startNewOrder: "Empezar un pedido nuevo",

  errPaypalOpen:
    "No se ha podido abrir PayPal: tu pedido está guardado; inténtalo con el botón de abajo o paga en el restaurante.",
  errCardOpen:
    "No se ha podido abrir el pago con tarjeta: tu pedido está guardado; inténtalo con el botón de abajo o paga en el restaurante.",
  errPayRetry: "Sin conexión: tu pedido está guardado; vuelve a intentar el pago abajo.",
  errUnknownItems:
    "La carta ha cambiado mientras hacías el pedido. Revisa los platos e inténtalo de nuevo.",
  errRateLimited: "Demasiados pedidos desde esta conexión: espera un minuto.",
  errTypeNotAvailable: "Este tipo de pedido acaba de desactivarse: elige otra opción.",
  errOutsideArea: "Lo sentimos, esa dirección está fuera de la zona de entrega.",
  errBelowMinimum: (min) => `La entrega empieza en ${min}: añade algo más.`,
  errInvalidTime: "Esa hora acaba de pasar o está fuera del horario: elige otra.",
  errGeneric: "El pedido no se ha completado. Inténtalo de nuevo.",
  errNoConnection: "Sin conexión: comprueba tu red e inténtalo de nuevo.",

  add: "+ Añadir",
  added: "Añadido ✓",
  addAria: (name) => `Añadir ${name} al pedido`,
};

const it: CheckoutCopy = {
  yourOrder: "Il tuo ordine",
  placedBadge: (n) => `Ordine n. ${n} ✓`,
  headingPlaced: (n) => `Ordine n. ${n}`,
  close: "Chiudi il pannello dell'ordine",

  each: (price) => `${price} l'uno`,
  oneLess: (name) => `Uno in meno di ${name}`,
  oneMore: (name) => `Uno in più di ${name}`,
  removeLine: (name) => `Rimuovi ${name} dall'ordine`,
  remove: "Rimuovi",
  total: "Totale",
  vatIncluded: (rate, amount) => `IVA ${rate}% inclusa ${amount}`,
  loyaltyEarn: (points) => `Guadagnerai ${points} punti con questo ordine`,
  loyaltySignIn: (points) => `Accedi e guadagna ${points} punti con questo ordine`,
  clearCart: "Svuota l'ordine",
  addItems: "Aggiungi piatti",

  orderTypeGroup: "Tipo di ordine",
  dineIn: "Al tavolo",
  takeaway: "Ritiro",
  delivery: "Consegna",

  tableNumber: "Numero del tavolo (facoltativo)",
  tableNumberPlaceholder: "es. 12",
  yourName: "Il tuo nome",
  phone: "Telefono",
  phonePlaceholder: "+39 …",
  deliveryTime: "Orario di consegna",
  pickupTime: "Orario di ritiro",
  asap: "Il prima possibile",
  email: "Email (facoltativa) — ti inviamo la ricevuta",
  emailPlaceholder: "tu@esempio.com",
  street: "Via e numero civico",
  zip: "CAP",
  selectPlaceholder: "Seleziona…",
  city: "Città / Comune / Frazione",
  cityPlaceholder: "— seleziona il tuo CAP —",
  deliveryNote: "Nota per la consegna (facoltativa)",
  deliveryNotePlaceholder: "es. suonare due volte, 3° piano",

  freeDeliveryHere: "Consegna gratuita in questa zona 🎉",
  freeDeliveryFrom: (amount) => `Consegna gratuita da ${amount}`,
  deliveryFee: (fee) => `Costo di consegna ${fee}`,
  minimumOrderSuffix: (min) => ` · ordine minimo ${min}`,
  minimumOrder: (min) => `Ordine minimo ${min}`,
  belowMinimum: (min, missing) => `La consegna parte da ${min}: mancano ${missing}.`,

  payGroup: "Ordina e paga",
  pay: "Paga",
  placeOrder: "Ordina",
  card: "Carta",
  paypal: "PayPal",
  payAtTable: "Paga al tavolo",
  payAtPickup: "Paga al ritiro",
  cashToDriver: "Contanti al fattorino",
  placing: "Invio…",
  opening: "Apertura…",
  explainerOnline:
    "Carta e PayPal aprono una pagina di pagamento sicura non appena l'ordine è salvato; nulla viene addebitato prima della tua conferma. Poi la ricevuta si scarica automaticamente.",
  explainerDelivery: "Nessun pagamento online: paghi al fattorino.",
  explainerPickup: "Nessun pagamento online: paghi al ritiro.",
  explainerDineIn: "Nessun pagamento adesso: paghi al ristorante.",
  weAccept: "Accettiamo",

  placedIntro: "Il tuo ordine è arrivato: lo staff lo vede come",
  placedRef: (n) => `ordine n. ${n}`,
  placedForTable: (table) => ` per il tavolo ${table}`,
  placedCashTail: ", da pagare al ristorante. La ricevuta si sta scaricando.",
  placedEmailTail: (email, pending) =>
    ` Invieremo la ricevuta a ${email}${pending ? " appena il pagamento è confermato" : ""}.`,
  payOnline: (amount) => `Paga online · ${amount}`,
  openingPayment: "Apertura del pagamento…",
  openingPaypal: "Apertura di PayPal…",
  payWithPaypal: "Paga con PayPal",
  trackOrder: "Segui il tuo ordine",
  downloadReceipt: "Scarica la ricevuta (PDF)",
  startNewOrder: "Inizia un nuovo ordine",

  errPaypalOpen:
    "Non è stato possibile aprire PayPal: il tuo ordine è salvato; riprova con il pulsante qui sotto o paga al ristorante.",
  errCardOpen:
    "Non è stato possibile aprire il pagamento con carta: il tuo ordine è salvato; riprova con il pulsante qui sotto o paga al ristorante.",
  errPayRetry: "Nessuna connessione: il tuo ordine è salvato; riprova il pagamento qui sotto.",
  errUnknownItems: "Il menu è cambiato mentre ordinavi. Controlla i piatti e riprova.",
  errRateLimited: "Troppi ordini da questa connessione: attendi un minuto.",
  errTypeNotAvailable: "Questo tipo di ordine è appena stato disattivato: scegli un'altra opzione.",
  errOutsideArea: "Spiacenti, l'indirizzo è fuori dalla zona di consegna.",
  errBelowMinimum: (min) => `La consegna parte da ${min}: aggiungi qualcosa.`,
  errInvalidTime:
    "Quell'orario è appena passato o è fuori dall'orario di apertura: scegline un altro.",
  errGeneric: "L'ordine non è andato a buon fine. Riprova.",
  errNoConnection: "Nessuna connessione: controlla la rete e riprova.",

  add: "+ Aggiungi",
  added: "Aggiunto ✓",
  addAria: (name) => `Aggiungi ${name} all'ordine`,
};

/* Modern Standard Arabic. Latin brand names (PayPal, PDF) stay Latin —
   that is how they appear on Arabic-language checkouts everywhere. */
const ar: CheckoutCopy = {
  yourOrder: "طلبك",
  placedBadge: (n) => `طلب رقم ${n} ✓`,
  headingPlaced: (n) => `طلب رقم ${n}`,
  close: "إغلاق لوحة الطلب",

  each: (price) => `${price} للقطعة`,
  oneLess: (name) => `إنقاص ${name} بمقدار واحد`,
  oneMore: (name) => `زيادة ${name} بمقدار واحد`,
  removeLine: (name) => `إزالة ${name} من الطلب`,
  remove: "إزالة",
  total: "الإجمالي",
  vatIncluded: (rate, amount) => `شامل ضريبة القيمة المضافة ${rate}% ${amount}`,
  loyaltyEarn: (points) => `ستحصل على ${points} نقطة مع هذا الطلب`,
  loyaltySignIn: (points) => `سجّل الدخول لتحصل على ${points} نقطة مع هذا الطلب`,
  clearCart: "إفراغ الطلب",
  addItems: "إضافة أصناف",

  orderTypeGroup: "نوع الطلب",
  dineIn: "في المطعم",
  takeaway: "استلام",
  delivery: "توصيل",

  tableNumber: "رقم الطاولة (اختياري)",
  tableNumberPlaceholder: "مثال: 12",
  yourName: "اسمك",
  phone: "رقم الهاتف",
  phonePlaceholder: "+49 …",
  deliveryTime: "وقت التوصيل",
  pickupTime: "وقت الاستلام",
  asap: "في أقرب وقت ممكن",
  email: "البريد الإلكتروني (اختياري) — سنرسل إليك الإيصال",
  emailPlaceholder: "you@example.com",
  street: "الشارع ورقم المبنى",
  zip: "الرمز البريدي",
  selectPlaceholder: "اختر…",
  city: "المدينة / البلدية / القرية",
  cityPlaceholder: "— اختر الرمز البريدي —",
  deliveryNote: "ملاحظة للتوصيل (اختياري)",
  deliveryNotePlaceholder: "مثال: اطرق الجرس مرتين، الطابق الثالث",

  freeDeliveryHere: "التوصيل مجاني إلى هذه المنطقة 🎉",
  freeDeliveryFrom: (amount) => `التوصيل مجاني ابتداءً من ${amount}`,
  deliveryFee: (fee) => `رسوم التوصيل ${fee}`,
  minimumOrderSuffix: (min) => ` · الحد الأدنى للطلب ${min}`,
  minimumOrder: (min) => `الحد الأدنى للطلب ${min}`,
  belowMinimum: (min, missing) => `يبدأ التوصيل من ${min} — أضف ${missing} أخرى.`,

  payGroup: "إتمام الطلب والدفع",
  pay: "ادفع",
  placeOrder: "أرسل الطلب",
  card: "بطاقة",
  paypal: "PayPal",
  payAtTable: "الدفع على الطاولة",
  payAtPickup: "الدفع عند الاستلام",
  cashToDriver: "نقدًا للسائق",
  placing: "جارٍ الإرسال…",
  opening: "جارٍ الفتح…",
  explainerOnline:
    "تفتح البطاقة وPayPal صفحة دفع آمنة بمجرد حفظ طلبك، ولا يُخصم أي مبلغ قبل تأكيدك هناك. يُنزَّل الإيصال تلقائيًا بعد ذلك.",
  explainerDelivery: "لا يوجد دفع عبر الإنترنت — تدفع للسائق.",
  explainerPickup: "لا يوجد دفع عبر الإنترنت — تدفع عند الاستلام.",
  explainerDineIn: "لا دفع الآن — تدفع في المطعم.",
  weAccept: "نقبل",

  placedIntro: "وصل طلبك — يراه الفريق باسم",
  placedRef: (n) => `الطلب رقم ${n}`,
  placedForTable: (table) => ` للطاولة ${table}`,
  placedCashTail: "، ويُدفع في المطعم. يجري تنزيل إيصالك.",
  placedEmailTail: (email, pending) =>
    ` سنرسل إيصالك إلى ${email}${pending ? " بمجرد تأكيد الدفع" : ""}.`,
  payOnline: (amount) => `الدفع عبر الإنترنت · ${amount}`,
  openingPayment: "جارٍ فتح صفحة الدفع…",
  openingPaypal: "جارٍ فتح PayPal…",
  payWithPaypal: "الدفع عبر PayPal",
  trackOrder: "تتبّع طلبك",
  downloadReceipt: "تنزيل الإيصال (PDF)",
  startNewOrder: "ابدأ طلبًا جديدًا",

  errPaypalOpen: "تعذّر فتح PayPal — طلبك محفوظ؛ جرّب الزر أدناه أو ادفع في المطعم.",
  errCardOpen: "تعذّر فتح الدفع بالبطاقة — طلبك محفوظ؛ جرّب الزر أدناه أو ادفع في المطعم.",
  errPayRetry: "لا يوجد اتصال — طلبك محفوظ؛ أعد محاولة الدفع أدناه.",
  errUnknownItems: "تغيّرت قائمة الطعام أثناء طلبك. راجع الأصناف وحاول مرة أخرى.",
  errRateLimited: "طلبات كثيرة من هذا الاتصال — يُرجى الانتظار دقيقة.",
  errTypeNotAvailable: "تم إيقاف هذا النوع من الطلبات للتو — اختر خيارًا آخر.",
  errOutsideArea: "عذرًا، هذا العنوان خارج منطقة التوصيل.",
  errBelowMinimum: (min) => `يبدأ التوصيل من ${min} — أضف المزيد قليلًا.`,
  errInvalidTime: "هذا الوقت انقضى للتو أو خارج ساعات العمل — اختر وقتًا آخر.",
  errGeneric: "لم يكتمل الطلب. يُرجى المحاولة مرة أخرى.",
  errNoConnection: "لا يوجد اتصال — تحقق من الشبكة وحاول مرة أخرى.",

  add: "+ إضافة",
  added: "تمت الإضافة ✓",
  addAria: (name) => `إضافة ${name} إلى الطلب`,
};

export const CHECKOUT_COPY: Record<UiLocale, CheckoutCopy> = { en, de, es, it, ar };

/** Checkout copy for a venue/route locale. Region tags collapse ("de-DE"
 *  → "de"); anything without a catalogue falls back to English. */
export const checkoutCopy = (locale?: string | null): CheckoutCopy =>
  CHECKOUT_COPY[uiLocale(locale)];
