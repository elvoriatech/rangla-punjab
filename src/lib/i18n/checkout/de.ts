/** Guest checkout copy — German (Deutsch). Loaded on its own chunk by
 *  `./load.ts`; `en.ts` supplies the shape (type-only import, so no
 *  English strings ride along). */
import type { CheckoutCopy } from "./en";

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

  addressTitle: "Lieferadresse",
  addressChange: "Ändern",

  timeNow: "Sofort",
  timeScheduled: "Geplant",
  closedPreorderNote: "Wir haben gerade geschlossen — Sie können für später heute vorbestellen.",
  closedDineIn: "Bestellen am Tisch ist nur während der Öffnungszeiten möglich.",
  timeEarlier: "Früher",
  timeLater: "Später",

  freeDeliveryHere: "Kostenlose Lieferung in dieses Gebiet 🎉",
  freeDeliveryFrom: (amount) => `Kostenlose Lieferung ab ${amount}`,
  deliveryFee: (fee) => `Liefergebühr ${fee}`,
  minimumOrderSuffix: (min) => ` · Mindestbestellwert ${min}`,
  minimumOrder: (min) => `Mindestbestellwert ${min}`,
  belowMinimum: (min, missing) => `Lieferung ab ${min} — es fehlen noch ${missing}.`,

  payGroup: "Bestellen und bezahlen",
  paymentMethod: "Zahlung",
  payOrChoose: "oder anders bezahlen",
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
  errWalletPay:
    "Die Wallet-Zahlung ist nicht durchgegangen — Ihre Bestellung ist gespeichert; bitte zahlen Sie unten auf andere Weise.",
  errUnknownItems:
    "Die Speisekarte hat sich während der Bestellung geändert. Bitte prüfen Sie Ihre Artikel und versuchen Sie es erneut.",
  errRateLimited: "Zu viele Bestellungen von dieser Verbindung — bitte warten Sie eine Minute.",
  errTypeNotAvailable:
    "Diese Bestellart ist gerade nicht mehr verfügbar — bitte wählen Sie eine andere.",
  errOutsideArea: "Diese Adresse liegt leider außerhalb des Liefergebiets.",
  errBelowMinimum: (min) => `Lieferung ab ${min} — bitte legen Sie noch etwas dazu.`,
  errInvalidTime:
    "Diese Zeit ist gerade vorbei oder liegt außerhalb der Öffnungszeiten — bitte wählen Sie eine andere.",
  errVenueClosed:
    "Wir haben gerade geschlossen — wählen Sie eine spätere Zeit heute oder versuchen Sie es morgen.",
  errGeneric: "Die Bestellung ist nicht durchgegangen. Bitte versuchen Sie es erneut.",
  errNoConnection: "Keine Verbindung — bitte prüfen Sie Ihr Netzwerk und versuchen Sie es erneut.",

  add: "+ Hinzufügen",
  added: "Hinzugefügt ✓",
  addAria: (name) => `${name} zur Bestellung hinzufügen`,

  requiredMark: "(Pflichtfeld)",
  requiredLegend: "* Pflichtfeld",
};

export default de;
