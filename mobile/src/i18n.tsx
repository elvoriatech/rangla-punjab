import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";

/**
 * App languages. One dictionary, one hook — the choice persists on the
 * device and also rides the menu request (?locale=) so translated menu
 * content follows when the restaurant maintains translations.
 *
 * The table below MIRRORS the web app's `src/lib/locales.ts` (the single
 * locale registry) — specifically its `ui: true` entries, i.e. the
 * locales with a complete guest-copy catalogue. The RN bundle cannot
 * import from the Next app's `src/`, so the five rows are copied here by
 * hand; keep them in the same order and with the same labels/flags/dir.
 * A venue may enable MORE locales than these (fr, nl, pl, …): those get
 * translated dish text from the API and English chrome, and they are
 * filtered out of the picker because this app has no catalogue for them.
 */
export const LANGS = [
  { code: "en", label: "English", flag: "🇬🇧", dir: "ltr" },
  { code: "de", label: "Deutsch", flag: "🇩🇪", dir: "ltr" },
  { code: "it", label: "Italiano", flag: "🇮🇹", dir: "ltr" },
  { code: "es", label: "Español", flag: "🇪🇸", dir: "ltr" },
  { code: "ar", label: "العربية", flag: "🇸🇦", dir: "rtl" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];
export type Dir = (typeof LANGS)[number]["dir"];

export const LANG_CODES = LANGS.map((l) => l.code) as readonly Lang[];

export function isLang(x: unknown): x is Lang {
  return typeof x === "string" && (LANG_CODES as readonly string[]).includes(x);
}

/** Collapses region tags ("de-DE" → "de") and returns undefined for
 *  anything this app has no catalogue for. */
export function toLang(code: string | null | undefined): Lang | undefined {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return isLang(base) ? base : undefined;
}

export function dirOf(lang: Lang): Dir {
  return LANGS.find((l) => l.code === lang)?.dir ?? "ltr";
}

/** BCP-47 tag for `Intl` / `toLocaleDateString`. */
export function localeTag(lang: Lang): string {
  switch (lang) {
    case "de":
      return "de-DE";
    case "it":
      return "it-IT";
    case "es":
      return "es-ES";
    case "ar":
      return "ar";
    default:
      return "en-GB";
  }
}

/** Diet icons are language-independent — the labels live in STRINGS. */
export const DIET_ICONS: Record<string, string> = {
  vegetarian: "🌿",
  vegan: "🌱",
  gluten_free: "🌾",
  dairy_free: "🥛",
  halal: "🕌",
};

/**
 * English is the canonical block: `Strings` is derived from it, so every
 * other language is structurally checked against it at compile time —
 * a missing or misspelled key fails `tsc`.
 *
 * The allergen + dietary maps are duplicated from `src/lib/allergens.ts`
 * on purpose (same reason as the locale table above); the guest surface
 * must never ship a raw key like "gluten_free".
 */
const en = {
  restaurant: "RESTAURANT",
  featCuisine: "Authentic\nCuisine",
  featFresh: "Fresh\nIngredients",
  featRecipes: "Traditional\nRecipes",
  featLove: "Served\nwith Love",
  welcome: "Welcome",
  taglineTop: "Authentic taste",
  taglineBottom: "Traditional recipes",
  startOrdering: "Start ordering",
  signInRegister: "Sign in / Register",
  tabStart: "Home",
  tabMenu: "Menu",
  tabCart: "Cart",
  tabOrders: "Orders",
  tabAccount: "Account",
  heroLine: "Delicious food,\njust one tap away!",
  delivery: "Delivery",
  deliverySub: "We deliver to you",
  pickup: "Pickup",
  pickupSub: "Order & collect",
  categories: "Categories",
  popular: "Popular dishes",
  showAll: "Show all",
  all: "All",
  soldOut: "sold out",
  offer: "OFFER",
  cartTitle: "Cart",
  cartEmpty: "Your cart is empty",
  cartEmptySub: "Add dishes from the menu.",
  dineIn: "Dine-in",
  tableOptional: "Table number (optional)",
  tablePlaceholder: "e.g. 12",
  timePickup: "Pickup time",
  timeDelivery: "Delivery time",
  asap: "As soon as possible",
  locality: "Locality",
  zipLabel: "Postcode",
  close: "Close",
  dishAllergens: "Allergens",
  dishTraces: "May contain traces of",
  dishAdd: "Add to cart",
  dishMore: "Details",
  reserveBtn: "Reserve a table",
  reserveSub: "Book your spot with us",
  reserveTitle: "Reserve a table",
  reserveLead: "Pick a date and time — we only show times we're open.",
  resDate: "Date",
  resTime: "Time",
  resGuests: "Guests",
  guest: "guest",
  guests: "guests",
  resNote: "Note (optional)",
  resNotePlaceholder: "Birthday, window seat …",
  resSubmit: "Request reservation",
  resSending: "Sending …",
  resFootnote: "No payment needed — the restaurant confirms by phone.",
  resDoneTitle: "Request received!",
  resDoneSub: "The restaurant will confirm your reservation by phone shortly.",
  resDoneBtn: "Done",
  resTimeGone: "That time just became unavailable — please pick another.",
  resTooMany: "Too many requests — please try again in a moment.",
  resFailed: "Failed — please try again or call us.",
  resNoSlots: "No reservations available right now.",
  email: "Email",
  passwordMin: "Password (min. 8 characters)",
  signInBtn: "Sign in",
  signUpBtn: "Sign up",
  orWithEmail: "or with email",
  authInvalid: "Wrong email or password.",
  authExists: "This email already has an account — sign in instead.",
  authFailed: "Failed — please try again.",
  name: "Name",
  namePlaceholder: "Your name",
  phone: "Phone",
  receiptEmail: "Email (optional)",
  receiptEmailHint: "For your receipt — we'll email it to you.",
  street: "Street & number",
  chooseZip: "Delivery area — choose your postcode",
  zipPick: "Please pick your postcode from the delivery areas.",
  deliveryFee: "Delivery fee",
  free: "free",
  minOrder: "Minimum order",
  freeOver: "free over",
  toMinimum: "to the minimum order for",
  still: "Still",
  noteOptional: "Note (optional)",
  notePlaceholder: "e.g. 2nd floor, ring Khan",
  subtotal: "Subtotal",
  total: "Total",
  placeOrder: "Place order",
  payAtRestaurant: "Pay at the restaurant — cash or card.",
  paymentMethod: "Payment",
  methodCard: "Card",
  methodPaypal: "PayPal",
  methodCash: "Cash",
  payHintCard: "Secure card payment via Stripe.",
  payHintPaypal: "You'll approve the payment in PayPal and return here.",
  payNow: "Pay",
  openingPayment: "Opening payment…",
  simulatePayment: "Simulate payment (test)",
  payWithCard: "Pay with card / Google Pay",
  payWithPaypal: "Pay with PayPal",
  payCancelledNote: "Payment cancelled — you can pay now or at the restaurant.",
  payFailedNote: "Payment failed — please try again.",
  orderFailed: "Order failed — please try again.",
  orderingPaused: "Ordering is paused right now — please try again later.",
  outsideArea: "Sorry, we don't deliver to this postcode.",
  belowMin: "The minimum order value hasn't been reached yet.",
  menuChanged: "The menu was updated — please review your cart.",
  trackTitle: "Track order",
  back: "Back",
  loadingOrder: "Loading order…",
  retrying: "Connection failed — retrying…",
  orderConfirmed: "Order confirmed",
  orderDone: "Order completed",
  orderNo: "Order number",
  table: "Table",
  paidOnline: "✓ Paid online",
  payConfirming: "✓ Payment received — confirming…",
  payNotYet: "Not paid yet",
  payAtRest: "Pay at the restaurant",
  receiptPdf: "Download receipt (PDF)",
  ordersTitle: "Orders",
  ordersEmpty: "No orders yet",
  ordersEmptySub: "Orders from this device will appear here.",
  accountOrders: "My orders (account)",
  accountTitle: "Account",
  language: "Language",
  signInLead: "Sign in to see your orders on every device.",
  signInGoogle: "Sign in with Google",
  signInDev: "Dev login (local only)",
  signInWaiting: "Waiting for sign-in in the browser…",
  signInCancel: "Cancel",
  signedInAs: "Signed in as",
  signOut: "Sign out",
  signInOptional: "Ordering works without an account — signing in is optional.",
  continueWithGoogle: "Continue with Google",
  signInToPrefill: "Sign in to fill this in automatically",
  restartTitle: "Restart the app",
  restartBody: "Please close and reopen the app to apply the new text direction.",
  hours: "Opening hours",
  closed: "closed",
  more: "More",
  webMenu: "Menu on the web",
  imprint: "Imprint",
  privacy: "Privacy",
  footer: "Traditional recipes, served with love 🌿",
  bootLoading: "Loading the menu…",
  bootError: "Can't reach the kitchen.",
  bootRetry: "Try again",
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  typeLabels: { dine_in: "Dine-in", takeaway: "Pickup", delivery: "Delivery" },
  allergens: {
    gluten: "gluten",
    crustaceans: "crustaceans",
    eggs: "eggs",
    fish: "fish",
    peanuts: "peanuts",
    soybeans: "soybeans",
    milk: "milk",
    nuts: "nuts",
    celery: "celery",
    mustard: "mustard",
    sesame: "sesame",
    sulphites: "sulphites",
    lupin: "lupin",
    molluscs: "molluscs",
  },
  dietary: {
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    gluten_free: "Gluten-free",
    dairy_free: "Dairy-free",
    halal: "Halal",
  },
};

export type Strings = typeof en;

const de: Strings = {
  restaurant: "RESTAURANT",
  featCuisine: "Authentische\nKüche",
  featFresh: "Frische\nZutaten",
  featRecipes: "Traditionelle\nRezepte",
  featLove: "Mit Liebe\nServiert",
  welcome: "Willkommen",
  taglineTop: "Authentischer Geschmack",
  taglineBottom: "Traditionelle Rezepte",
  startOrdering: "Bestellung Starten",
  signInRegister: "Anmelden / Registrieren",
  tabStart: "Start",
  tabMenu: "Kategorien",
  tabCart: "Warenkorb",
  tabOrders: "Bestellungen",
  tabAccount: "Konto",
  heroLine: "Leckeres Essen\nnur einen Klick entfernt!",
  delivery: "Lieferung",
  deliverySub: "Wir liefern zu dir",
  pickup: "Abholung",
  pickupSub: "Bestelle & hole ab",
  categories: "Kategorien",
  popular: "Beliebte Gerichte",
  showAll: "Alle anzeigen",
  all: "Alle",
  soldOut: "ausverkauft",
  offer: "ANGEBOT",
  cartTitle: "Warenkorb",
  cartEmpty: "Dein Warenkorb ist leer",
  cartEmptySub: "Füge Gerichte aus der Speisekarte hinzu.",
  dineIn: "Im Restaurant",
  tableOptional: "Tischnummer (optional)",
  tablePlaceholder: "z. B. 12",
  timePickup: "Abholzeit",
  timeDelivery: "Lieferzeit",
  asap: "So schnell wie möglich",
  locality: "Ort",
  zipLabel: "PLZ",
  close: "Schließen",
  dishAllergens: "Allergene",
  dishTraces: "Kann Spuren enthalten von",
  dishAdd: "Zum Warenkorb",
  dishMore: "Details",
  reserveBtn: "Tisch reservieren",
  reserveSub: "Platz im Restaurant sichern",
  reserveTitle: "Tisch reservieren",
  reserveLead: "Wähle Datum und Uhrzeit — wir zeigen nur Zeiten, zu denen wir geöffnet sind.",
  resDate: "Datum",
  resTime: "Uhrzeit",
  resGuests: "Personen",
  guest: "Person",
  guests: "Personen",
  resNote: "Hinweis (optional)",
  resNotePlaceholder: "Geburtstag, Fensterplatz …",
  resSubmit: "Reservierung anfragen",
  resSending: "Wird gesendet …",
  resFootnote: "Keine Zahlung nötig — das Restaurant bestätigt telefonisch.",
  resDoneTitle: "Anfrage erhalten!",
  resDoneSub: "Das Restaurant bestätigt deine Reservierung in Kürze telefonisch.",
  resDoneBtn: "Fertig",
  resTimeGone: "Diese Zeit ist gerade vergeben — bitte eine andere wählen.",
  resTooMany: "Zu viele Anfragen — bitte kurz warten.",
  resFailed: "Fehlgeschlagen — bitte erneut versuchen oder anrufen.",
  resNoSlots: "Zurzeit sind keine Reservierungen möglich.",
  email: "E-Mail",
  passwordMin: "Passwort (min. 8 Zeichen)",
  signInBtn: "Anmelden",
  signUpBtn: "Registrieren",
  orWithEmail: "oder mit E-Mail",
  authInvalid: "E-Mail oder Passwort falsch.",
  authExists: "Diese E-Mail hat bereits ein Konto — bitte anmelden.",
  authFailed: "Fehlgeschlagen — bitte erneut versuchen.",
  name: "Name",
  namePlaceholder: "Dein Name",
  phone: "Telefon",
  receiptEmail: "E-Mail (optional)",
  receiptEmailHint: "Für deinen Beleg — wir schicken ihn dir per E-Mail.",
  street: "Straße & Hausnummer",
  chooseZip: "Liefergebiet — PLZ wählen",
  zipPick: "Bitte wähle deine PLZ aus den Liefergebieten.",
  deliveryFee: "Liefergebühr",
  free: "gratis",
  minOrder: "Mindestbestellwert",
  freeOver: "gratis ab",
  toMinimum: "bis zum Mindestbestellwert für",
  still: "Noch",
  noteOptional: "Hinweis (optional)",
  notePlaceholder: "z. B. 2. Etage, bei Khan klingeln",
  subtotal: "Zwischensumme",
  total: "Gesamt",
  placeOrder: "Bestellung aufgeben",
  payAtRestaurant: "Bezahlung im Restaurant — bar oder mit Karte.",
  paymentMethod: "Zahlung",
  methodCard: "Karte",
  methodPaypal: "PayPal",
  methodCash: "Bar",
  payHintCard: "Sichere Kartenzahlung über Stripe.",
  payHintPaypal: "Du bestätigst die Zahlung bei PayPal und kommst danach hierher zurück.",
  payNow: "Bezahlen",
  openingPayment: "Zahlung wird geöffnet…",
  simulatePayment: "Zahlung simulieren (Test)",
  payWithCard: "Mit Karte / Google Pay bezahlen",
  payWithPaypal: "Mit PayPal bezahlen",
  payCancelledNote: "Zahlung abgebrochen — du kannst jetzt oder im Restaurant bezahlen.",
  payFailedNote: "Zahlung fehlgeschlagen — bitte erneut versuchen.",
  orderFailed: "Bestellung fehlgeschlagen — bitte erneut versuchen.",
  orderingPaused: "Bestellungen sind gerade pausiert — bitte versuche es später.",
  outsideArea: "Leider liefern wir nicht in diese PLZ.",
  belowMin: "Der Mindestbestellwert ist noch nicht erreicht.",
  menuChanged: "Die Karte wurde aktualisiert — bitte Warenkorb prüfen.",
  trackTitle: "Bestellung verfolgen",
  back: "Zurück",
  loadingOrder: "Lade Bestellung…",
  retrying: "Verbindung fehlgeschlagen — neuer Versuch…",
  orderConfirmed: "Bestellung bestätigt",
  orderDone: "Bestellung abgeschlossen",
  orderNo: "Bestellnummer",
  table: "Tisch",
  paidOnline: "✓ Online bezahlt",
  payConfirming: "✓ Zahlung eingegangen — wird bestätigt…",
  payNotYet: "Noch nicht bezahlt",
  payAtRest: "Zahlung im Restaurant",
  receiptPdf: "Beleg herunterladen (PDF)",
  ordersTitle: "Bestellungen",
  ordersEmpty: "Noch keine Bestellungen",
  ordersEmptySub: "Deine Bestellungen von diesem Gerät erscheinen hier.",
  accountOrders: "Meine Bestellungen (Konto)",
  accountTitle: "Konto",
  language: "Sprache",
  signInLead: "Melde dich an, um deine Bestellungen auf allen Geräten zu sehen.",
  signInGoogle: "Mit Google anmelden",
  signInDev: "Dev-Login (nur lokal)",
  signInWaiting: "Warte auf Anmeldung im Browser…",
  signInCancel: "Abbrechen",
  signedInAs: "Angemeldet als",
  signOut: "Abmelden",
  signInOptional: "Bestellen geht auch ohne Konto — die Anmeldung ist optional.",
  continueWithGoogle: "Mit Google fortfahren",
  signInToPrefill: "Melde dich an, um diese Angaben automatisch auszufüllen",
  restartTitle: "App neu starten",
  restartBody: "Bitte schließe die App und öffne sie erneut, damit die neue Schreibrichtung wirkt.",
  hours: "Öffnungszeiten",
  closed: "geschlossen",
  more: "Mehr",
  webMenu: "Speisekarte im Web",
  imprint: "Impressum",
  privacy: "Datenschutz",
  footer: "Traditionelle Rezepte mit Liebe serviert 🌿",
  bootLoading: "Speisekarte wird geladen…",
  bootError: "Keine Verbindung zur Küche.",
  bootRetry: "Erneut versuchen",
  days: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
  typeLabels: { dine_in: "Im Restaurant", takeaway: "Abholung", delivery: "Lieferung" },
  allergens: {
    gluten: "Gluten",
    crustaceans: "Krebstiere",
    eggs: "Eier",
    fish: "Fisch",
    peanuts: "Erdnüsse",
    soybeans: "Sojabohnen",
    milk: "Milch",
    nuts: "Schalenfrüchte",
    celery: "Sellerie",
    mustard: "Senf",
    sesame: "Sesam",
    sulphites: "Sulfite",
    lupin: "Lupinen",
    molluscs: "Weichtiere",
  },
  dietary: {
    vegetarian: "Vegetarisch",
    vegan: "Vegan",
    gluten_free: "Glutenfrei",
    dairy_free: "Laktosefrei",
    halal: "Halal",
  },
};

const it: Strings = {
  restaurant: "RISTORANTE",
  featCuisine: "Cucina\nautentica",
  featFresh: "Ingredienti\nfreschi",
  featRecipes: "Ricette\ntradizionali",
  featLove: "Servito\ncon amore",
  welcome: "Benvenuto",
  taglineTop: "Sapore autentico",
  taglineBottom: "Ricette tradizionali",
  startOrdering: "Inizia l'ordine",
  signInRegister: "Accedi / Registrati",
  tabStart: "Home",
  tabMenu: "Menù",
  tabCart: "Carrello",
  tabOrders: "Ordini",
  tabAccount: "Account",
  heroLine: "Piatti deliziosi,\na un solo tocco!",
  delivery: "Consegna",
  deliverySub: "Consegniamo da te",
  pickup: "Ritiro",
  pickupSub: "Ordina e ritira",
  categories: "Categorie",
  popular: "Piatti più richiesti",
  showAll: "Mostra tutto",
  all: "Tutti",
  soldOut: "esaurito",
  offer: "OFFERTA",
  cartTitle: "Carrello",
  cartEmpty: "Il carrello è vuoto",
  cartEmptySub: "Aggiungi piatti dal menù.",
  dineIn: "Al ristorante",
  tableOptional: "Numero del tavolo (facoltativo)",
  tablePlaceholder: "es. 12",
  timePickup: "Orario di ritiro",
  timeDelivery: "Orario di consegna",
  asap: "Il prima possibile",
  locality: "Località",
  zipLabel: "CAP",
  close: "Chiudi",
  dishAllergens: "Allergeni",
  dishTraces: "Può contenere tracce di",
  dishAdd: "Aggiungi al carrello",
  dishMore: "Dettagli",
  reserveBtn: "Prenota un tavolo",
  reserveSub: "Assicurati un posto da noi",
  reserveTitle: "Prenota un tavolo",
  reserveLead: "Scegli data e ora — mostriamo solo gli orari in cui siamo aperti.",
  resDate: "Data",
  resTime: "Ora",
  resGuests: "Persone",
  guest: "persona",
  guests: "persone",
  resNote: "Nota (facoltativa)",
  resNotePlaceholder: "Compleanno, tavolo vicino alla finestra …",
  resSubmit: "Richiedi la prenotazione",
  resSending: "Invio in corso …",
  resFootnote: "Nessun pagamento richiesto — il ristorante conferma per telefono.",
  resDoneTitle: "Richiesta ricevuta!",
  resDoneSub: "Il ristorante confermerà la prenotazione per telefono a breve.",
  resDoneBtn: "Fatto",
  resTimeGone: "Questo orario non è più disponibile — scegline un altro.",
  resTooMany: "Troppe richieste — riprova tra poco.",
  resFailed: "Operazione non riuscita — riprova o chiamaci.",
  resNoSlots: "Al momento non ci sono prenotazioni disponibili.",
  email: "E-mail",
  passwordMin: "Password (min. 8 caratteri)",
  signInBtn: "Accedi",
  signUpBtn: "Registrati",
  orWithEmail: "oppure con e-mail",
  authInvalid: "E-mail o password errate.",
  authExists: "Questa e-mail ha già un account — accedi.",
  authFailed: "Operazione non riuscita — riprova.",
  name: "Nome",
  namePlaceholder: "Il tuo nome",
  phone: "Telefono",
  receiptEmail: "E-mail (facoltativa)",
  receiptEmailHint: "Per la ricevuta — te la inviamo via e-mail.",
  street: "Via e numero civico",
  chooseZip: "Zona di consegna — scegli il CAP",
  zipPick: "Scegli il tuo CAP tra le zone di consegna.",
  deliveryFee: "Costo di consegna",
  free: "gratis",
  minOrder: "Ordine minimo",
  freeOver: "gratis oltre",
  toMinimum: "all'ordine minimo per",
  still: "Mancano",
  noteOptional: "Nota (facoltativa)",
  notePlaceholder: "es. 2º piano, citofono Khan",
  subtotal: "Subtotale",
  total: "Totale",
  placeOrder: "Invia l'ordine",
  payAtRestaurant: "Pagamento al ristorante — contanti o carta.",
  paymentMethod: "Pagamento",
  methodCard: "Carta",
  methodPaypal: "PayPal",
  methodCash: "Contanti",
  payHintCard: "Pagamento sicuro con carta tramite Stripe.",
  payHintPaypal: "Autorizzi il pagamento su PayPal e torni qui.",
  payNow: "Paga",
  openingPayment: "Apertura del pagamento…",
  simulatePayment: "Simula il pagamento (test)",
  payWithCard: "Paga con carta / Google Pay",
  payWithPaypal: "Paga con PayPal",
  payCancelledNote: "Pagamento annullato — puoi pagare ora oppure al ristorante.",
  payFailedNote: "Pagamento non riuscito — riprova.",
  orderFailed: "Ordine non riuscito — riprova.",
  orderingPaused: "Gli ordini sono sospesi al momento — riprova più tardi.",
  outsideArea: "Purtroppo non consegniamo a questo CAP.",
  belowMin: "L'ordine minimo non è ancora stato raggiunto.",
  menuChanged: "Il menù è stato aggiornato — controlla il carrello.",
  trackTitle: "Segui l'ordine",
  back: "Indietro",
  loadingOrder: "Caricamento dell'ordine…",
  retrying: "Connessione non riuscita — nuovo tentativo…",
  orderConfirmed: "Ordine confermato",
  orderDone: "Ordine completato",
  orderNo: "Numero d'ordine",
  table: "Tavolo",
  paidOnline: "✓ Pagato online",
  payConfirming: "✓ Pagamento ricevuto — in conferma…",
  payNotYet: "Non ancora pagato",
  payAtRest: "Pagamento al ristorante",
  receiptPdf: "Scarica la ricevuta (PDF)",
  ordersTitle: "Ordini",
  ordersEmpty: "Nessun ordine",
  ordersEmptySub: "Qui compaiono gli ordini fatti da questo dispositivo.",
  accountOrders: "I miei ordini (account)",
  accountTitle: "Account",
  language: "Lingua",
  signInLead: "Accedi per vedere i tuoi ordini su tutti i dispositivi.",
  signInGoogle: "Accedi con Google",
  signInDev: "Accesso di sviluppo (solo locale)",
  signInWaiting: "In attesa dell'accesso nel browser…",
  signInCancel: "Annulla",
  signedInAs: "Hai effettuato l'accesso come",
  signOut: "Esci",
  signInOptional: "Puoi ordinare senza account — l'accesso è facoltativo.",
  continueWithGoogle: "Continua con Google",
  signInToPrefill: "Accedi per compilare questi dati automaticamente",
  restartTitle: "Riavvia l'app",
  restartBody: "Chiudi e riapri l'app per applicare la nuova direzione del testo.",
  hours: "Orari di apertura",
  closed: "chiuso",
  more: "Altro",
  webMenu: "Menù sul sito",
  imprint: "Note legali",
  privacy: "Privacy",
  footer: "Ricette tradizionali servite con amore 🌿",
  bootLoading: "Caricamento del menù…",
  bootError: "Nessuna connessione con la cucina.",
  bootRetry: "Riprova",
  days: ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
  typeLabels: { dine_in: "Al ristorante", takeaway: "Ritiro", delivery: "Consegna" },
  allergens: {
    gluten: "glutine",
    crustaceans: "crostacei",
    eggs: "uova",
    fish: "pesce",
    peanuts: "arachidi",
    soybeans: "soia",
    milk: "latte",
    nuts: "frutta a guscio",
    celery: "sedano",
    mustard: "senape",
    sesame: "sesamo",
    sulphites: "solfiti",
    lupin: "lupini",
    molluscs: "molluschi",
  },
  dietary: {
    vegetarian: "Vegetariano",
    vegan: "Vegano",
    gluten_free: "Senza glutine",
    dairy_free: "Senza lattosio",
    halal: "Halal",
  },
};

const es: Strings = {
  restaurant: "RESTAURANTE",
  featCuisine: "Cocina\nauténtica",
  featFresh: "Ingredientes\nfrescos",
  featRecipes: "Recetas\ntradicionales",
  featLove: "Servido\ncon cariño",
  welcome: "Bienvenido",
  taglineTop: "Sabor auténtico",
  taglineBottom: "Recetas tradicionales",
  startOrdering: "Empezar el pedido",
  signInRegister: "Iniciar sesión / Registrarse",
  tabStart: "Inicio",
  tabMenu: "Carta",
  tabCart: "Cesta",
  tabOrders: "Pedidos",
  tabAccount: "Cuenta",
  heroLine: "Comida deliciosa,\n¡a un solo toque!",
  delivery: "A domicilio",
  deliverySub: "Te lo llevamos a casa",
  pickup: "Recogida",
  pickupSub: "Pide y recoge",
  categories: "Categorías",
  popular: "Platos populares",
  showAll: "Ver todo",
  all: "Todos",
  soldOut: "agotado",
  offer: "OFERTA",
  cartTitle: "Cesta",
  cartEmpty: "Tu cesta está vacía",
  cartEmptySub: "Añade platos de la carta.",
  dineIn: "En el restaurante",
  tableOptional: "Número de mesa (opcional)",
  tablePlaceholder: "p. ej. 12",
  timePickup: "Hora de recogida",
  timeDelivery: "Hora de entrega",
  asap: "Lo antes posible",
  locality: "Localidad",
  zipLabel: "Código postal",
  close: "Cerrar",
  dishAllergens: "Alérgenos",
  dishTraces: "Puede contener trazas de",
  dishAdd: "Añadir a la cesta",
  dishMore: "Detalles",
  reserveBtn: "Reservar mesa",
  reserveSub: "Reserva tu sitio con nosotros",
  reserveTitle: "Reservar mesa",
  reserveLead: "Elige fecha y hora — solo mostramos las horas en las que estamos abiertos.",
  resDate: "Fecha",
  resTime: "Hora",
  resGuests: "Comensales",
  guest: "comensal",
  guests: "comensales",
  resNote: "Nota (opcional)",
  resNotePlaceholder: "Cumpleaños, mesa junto a la ventana …",
  resSubmit: "Solicitar reserva",
  resSending: "Enviando …",
  resFootnote: "No hace falta pagar — el restaurante confirma por teléfono.",
  resDoneTitle: "¡Solicitud recibida!",
  resDoneSub: "El restaurante confirmará tu reserva por teléfono en breve.",
  resDoneBtn: "Listo",
  resTimeGone: "Esa hora acaba de ocuparse — elige otra, por favor.",
  resTooMany: "Demasiadas solicitudes — inténtalo de nuevo en un momento.",
  resFailed: "No se ha podido completar — inténtalo de nuevo o llámanos.",
  resNoSlots: "Ahora mismo no hay reservas disponibles.",
  email: "Correo electrónico",
  passwordMin: "Contraseña (mín. 8 caracteres)",
  signInBtn: "Iniciar sesión",
  signUpBtn: "Registrarse",
  orWithEmail: "o con correo electrónico",
  authInvalid: "Correo electrónico o contraseña incorrectos.",
  authExists: "Este correo ya tiene una cuenta — inicia sesión.",
  authFailed: "No se ha podido completar — inténtalo de nuevo.",
  name: "Nombre",
  namePlaceholder: "Tu nombre",
  phone: "Teléfono",
  receiptEmail: "Correo electrónico (opcional)",
  receiptEmailHint: "Para tu recibo — te lo enviamos por correo.",
  street: "Calle y número",
  chooseZip: "Zona de reparto — elige tu código postal",
  zipPick: "Elige tu código postal entre las zonas de reparto.",
  deliveryFee: "Gastos de envío",
  free: "gratis",
  minOrder: "Pedido mínimo",
  freeOver: "gratis a partir de",
  toMinimum: "para el pedido mínimo en",
  still: "Faltan",
  noteOptional: "Nota (opcional)",
  notePlaceholder: "p. ej. 2.º piso, llamar a Khan",
  subtotal: "Subtotal",
  total: "Total",
  placeOrder: "Realizar pedido",
  payAtRestaurant: "Pago en el restaurante — en efectivo o con tarjeta.",
  paymentMethod: "Pago",
  methodCard: "Tarjeta",
  methodPaypal: "PayPal",
  methodCash: "Efectivo",
  payHintCard: "Pago seguro con tarjeta a través de Stripe.",
  payHintPaypal: "Aprobarás el pago en PayPal y volverás aquí.",
  payNow: "Pagar",
  openingPayment: "Abriendo el pago…",
  simulatePayment: "Simular pago (prueba)",
  payWithCard: "Pagar con tarjeta / Google Pay",
  payWithPaypal: "Pagar con PayPal",
  payCancelledNote: "Pago cancelado — puedes pagar ahora o en el restaurante.",
  payFailedNote: "No se ha podido completar el pago — inténtalo de nuevo.",
  orderFailed: "No se ha podido realizar el pedido — inténtalo de nuevo.",
  orderingPaused: "Los pedidos están pausados ahora mismo — inténtalo más tarde.",
  outsideArea: "Lo sentimos, no repartimos en este código postal.",
  belowMin: "Aún no se ha alcanzado el pedido mínimo.",
  menuChanged: "La carta se ha actualizado — revisa tu cesta.",
  trackTitle: "Seguir el pedido",
  back: "Atrás",
  loadingOrder: "Cargando el pedido…",
  retrying: "Error de conexión — reintentando…",
  orderConfirmed: "Pedido confirmado",
  orderDone: "Pedido completado",
  orderNo: "Número de pedido",
  table: "Mesa",
  paidOnline: "✓ Pagado online",
  payConfirming: "✓ Pago recibido — confirmando…",
  payNotYet: "Aún no pagado",
  payAtRest: "Pago en el restaurante",
  receiptPdf: "Descargar recibo (PDF)",
  ordersTitle: "Pedidos",
  ordersEmpty: "Todavía no hay pedidos",
  ordersEmptySub: "Aquí aparecerán los pedidos hechos desde este dispositivo.",
  accountOrders: "Mis pedidos (cuenta)",
  accountTitle: "Cuenta",
  language: "Idioma",
  signInLead: "Inicia sesión para ver tus pedidos en todos tus dispositivos.",
  signInGoogle: "Iniciar sesión con Google",
  signInDev: "Acceso de desarrollo (solo local)",
  signInWaiting: "Esperando el inicio de sesión en el navegador…",
  signInCancel: "Cancelar",
  signedInAs: "Sesión iniciada como",
  signOut: "Cerrar sesión",
  signInOptional: "Puedes pedir sin cuenta — iniciar sesión es opcional.",
  continueWithGoogle: "Continuar con Google",
  signInToPrefill: "Inicia sesión para rellenar estos datos automáticamente",
  restartTitle: "Reinicia la aplicación",
  restartBody: "Cierra la aplicación y vuelve a abrirla para aplicar la nueva dirección del texto.",
  hours: "Horario",
  closed: "cerrado",
  more: "Más",
  webMenu: "Carta en la web",
  imprint: "Aviso legal",
  privacy: "Privacidad",
  footer: "Recetas tradicionales servidas con cariño 🌿",
  bootLoading: "Cargando la carta…",
  bootError: "No hay conexión con la cocina.",
  bootRetry: "Reintentar",
  days: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
  typeLabels: { dine_in: "En el restaurante", takeaway: "Recogida", delivery: "A domicilio" },
  allergens: {
    gluten: "gluten",
    crustaceans: "crustáceos",
    eggs: "huevos",
    fish: "pescado",
    peanuts: "cacahuetes",
    soybeans: "soja",
    milk: "leche",
    nuts: "frutos de cáscara",
    celery: "apio",
    mustard: "mostaza",
    sesame: "sésamo",
    sulphites: "sulfitos",
    lupin: "altramuces",
    molluscs: "moluscos",
  },
  dietary: {
    vegetarian: "Vegetariano",
    vegan: "Vegano",
    gluten_free: "Sin gluten",
    dairy_free: "Sin lactosa",
    halal: "Halal",
  },
};

const ar: Strings = {
  restaurant: "مطعم",
  featCuisine: "مطبخ\nأصيل",
  featFresh: "مكوّنات\nطازجة",
  featRecipes: "وصفات\nتقليدية",
  featLove: "تُقدَّم\nبمحبة",
  welcome: "أهلاً وسهلاً",
  taglineTop: "نكهة أصيلة",
  taglineBottom: "وصفات تقليدية",
  startOrdering: "ابدأ الطلب",
  signInRegister: "تسجيل الدخول / إنشاء حساب",
  tabStart: "الرئيسية",
  tabMenu: "القائمة",
  tabCart: "السلة",
  tabOrders: "الطلبات",
  tabAccount: "الحساب",
  heroLine: "طعام شهي\nعلى بُعد نقرة واحدة!",
  delivery: "توصيل",
  deliverySub: "نوصّل إليك",
  pickup: "استلام",
  pickupSub: "اطلب واستلم",
  categories: "الفئات",
  popular: "الأطباق الأكثر طلباً",
  showAll: "عرض الكل",
  all: "الكل",
  soldOut: "نفدت الكمية",
  offer: "عرض",
  cartTitle: "السلة",
  cartEmpty: "سلتك فارغة",
  cartEmptySub: "أضف أطباقاً من القائمة.",
  dineIn: "في المطعم",
  tableOptional: "رقم الطاولة (اختياري)",
  tablePlaceholder: "مثال: 12",
  timePickup: "وقت الاستلام",
  timeDelivery: "وقت التوصيل",
  asap: "في أقرب وقت ممكن",
  locality: "المدينة",
  zipLabel: "الرمز البريدي",
  close: "إغلاق",
  dishAllergens: "مسببات الحساسية",
  dishTraces: "قد يحتوي على آثار من",
  dishAdd: "أضف إلى السلة",
  dishMore: "التفاصيل",
  reserveBtn: "احجز طاولة",
  reserveSub: "احجز مكانك لدينا",
  reserveTitle: "حجز طاولة",
  reserveLead: "اختر التاريخ والوقت — نعرض فقط الأوقات التي نكون فيها مفتوحين.",
  resDate: "التاريخ",
  resTime: "الوقت",
  resGuests: "عدد الضيوف",
  guest: "ضيف",
  guests: "ضيوف",
  resNote: "ملاحظة (اختياري)",
  resNotePlaceholder: "عيد ميلاد، طاولة بجانب النافذة …",
  resSubmit: "إرسال طلب الحجز",
  resSending: "جارٍ الإرسال …",
  resFootnote: "لا حاجة للدفع — يؤكد المطعم الحجز هاتفياً.",
  resDoneTitle: "تم استلام الطلب!",
  resDoneSub: "سيؤكد المطعم حجزك هاتفياً قريباً.",
  resDoneBtn: "تم",
  resTimeGone: "هذا الوقت لم يعد متاحاً — يُرجى اختيار وقت آخر.",
  resTooMany: "طلبات كثيرة جداً — يُرجى المحاولة بعد قليل.",
  resFailed: "فشلت العملية — يُرجى المحاولة مرة أخرى أو الاتصال بنا.",
  resNoSlots: "لا تتوفر حجوزات في الوقت الحالي.",
  email: "البريد الإلكتروني",
  passwordMin: "كلمة المرور (8 أحرف على الأقل)",
  signInBtn: "تسجيل الدخول",
  signUpBtn: "إنشاء حساب",
  orWithEmail: "أو بالبريد الإلكتروني",
  authInvalid: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  authExists: "هذا البريد الإلكتروني لديه حساب بالفعل — يُرجى تسجيل الدخول.",
  authFailed: "فشلت العملية — يُرجى المحاولة مرة أخرى.",
  name: "الاسم",
  namePlaceholder: "اسمك",
  phone: "الهاتف",
  receiptEmail: "البريد الإلكتروني (اختياري)",
  receiptEmailHint: "لإيصالك — سنرسله إليك بالبريد الإلكتروني.",
  street: "الشارع ورقم المبنى",
  chooseZip: "منطقة التوصيل — اختر الرمز البريدي",
  zipPick: "يُرجى اختيار الرمز البريدي من مناطق التوصيل.",
  deliveryFee: "رسوم التوصيل",
  free: "مجاناً",
  minOrder: "الحد الأدنى للطلب",
  freeOver: "مجاناً عند تجاوز",
  toMinimum: "للوصول إلى الحد الأدنى للطلب في",
  still: "يتبقى",
  noteOptional: "ملاحظة (اختياري)",
  notePlaceholder: "مثال: الطابق الثاني، جرس خان",
  subtotal: "المجموع الفرعي",
  total: "الإجمالي",
  placeOrder: "إتمام الطلب",
  payAtRestaurant: "الدفع في المطعم — نقداً أو بالبطاقة.",
  paymentMethod: "الدفع",
  methodCard: "بطاقة",
  methodPaypal: "باي بال",
  methodCash: "نقداً",
  payHintCard: "دفع آمن بالبطاقة عبر Stripe.",
  payHintPaypal: "ستؤكّد الدفع في باي بال ثم تعود إلى هنا.",
  payNow: "ادفع",
  openingPayment: "جارٍ فتح صفحة الدفع…",
  simulatePayment: "محاكاة الدفع (اختبار)",
  payWithCard: "الدفع بالبطاقة / Google Pay",
  payWithPaypal: "الدفع عبر باي بال",
  payCancelledNote: "أُلغي الدفع — يمكنك الدفع الآن أو في المطعم.",
  payFailedNote: "تعذّر إتمام الدفع — يُرجى المحاولة مرة أخرى.",
  orderFailed: "تعذّر إرسال الطلب — يُرجى المحاولة مرة أخرى.",
  orderingPaused: "الطلبات متوقفة مؤقتاً — يُرجى المحاولة لاحقاً.",
  outsideArea: "للأسف لا نوصّل إلى هذا الرمز البريدي.",
  belowMin: "لم يتم بلوغ الحد الأدنى للطلب بعد.",
  menuChanged: "تم تحديث القائمة — يُرجى مراجعة سلتك.",
  trackTitle: "تتبّع الطلب",
  back: "رجوع",
  loadingOrder: "جارٍ تحميل الطلب…",
  retrying: "فشل الاتصال — تتم إعادة المحاولة…",
  orderConfirmed: "تم تأكيد الطلب",
  orderDone: "اكتمل الطلب",
  orderNo: "رقم الطلب",
  table: "طاولة",
  paidOnline: "✓ تم الدفع عبر الإنترنت",
  payConfirming: "✓ تم استلام الدفع — جارٍ التأكيد…",
  payNotYet: "لم يتم الدفع بعد",
  payAtRest: "الدفع في المطعم",
  receiptPdf: "تنزيل الإيصال (PDF)",
  ordersTitle: "الطلبات",
  ordersEmpty: "لا توجد طلبات بعد",
  ordersEmptySub: "ستظهر هنا طلباتك من هذا الجهاز.",
  accountOrders: "طلباتي (الحساب)",
  accountTitle: "الحساب",
  language: "اللغة",
  signInLead: "سجّل الدخول لترى طلباتك على جميع أجهزتك.",
  signInGoogle: "تسجيل الدخول بحساب Google",
  signInDev: "دخول المطوّر (محلي فقط)",
  signInWaiting: "في انتظار تسجيل الدخول في المتصفح…",
  signInCancel: "إلغاء",
  signedInAs: "مسجّل الدخول باسم",
  signOut: "تسجيل الخروج",
  signInOptional: "يمكنك الطلب بدون حساب — تسجيل الدخول اختياري.",
  continueWithGoogle: "المتابعة باستخدام Google",
  signInToPrefill: "سجّل الدخول لتعبئة هذه البيانات تلقائياً",
  restartTitle: "أعد تشغيل التطبيق",
  restartBody: "أغلق التطبيق وافتحه من جديد لتطبيق اتجاه الكتابة الجديد.",
  hours: "أوقات العمل",
  closed: "مغلق",
  more: "المزيد",
  webMenu: "القائمة على الويب",
  imprint: "بيانات الناشر",
  privacy: "الخصوصية",
  footer: "وصفات تقليدية تُقدَّم بمحبة 🌿",
  bootLoading: "جارٍ تحميل القائمة…",
  bootError: "تعذّر الاتصال بالمطبخ.",
  bootRetry: "إعادة المحاولة",
  days: ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
  typeLabels: { dine_in: "في المطعم", takeaway: "استلام", delivery: "توصيل" },
  allergens: {
    gluten: "الغلوتين",
    crustaceans: "القشريات",
    eggs: "البيض",
    fish: "الأسماك",
    peanuts: "الفول السوداني",
    soybeans: "فول الصويا",
    milk: "الحليب",
    nuts: "المكسّرات",
    celery: "الكرفس",
    mustard: "الخردل",
    sesame: "السمسم",
    sulphites: "الكبريتيت",
    lupin: "الترمس",
    molluscs: "الرخويات",
  },
  dietary: {
    vegetarian: "نباتي",
    vegan: "نباتي صرف",
    gluten_free: "خالٍ من الغلوتين",
    dairy_free: "خالٍ من الألبان",
    halal: "حلال",
  },
};

const STRINGS: Record<Lang, Strings> = { en, de, it, es, ar };

/** What the venue told us about its languages (from /api/v1/menu). */
export interface VenueLocales {
  defaultLocale?: string | null;
  enabledLocales?: string[] | null;
}

interface I18nApi {
  lang: Lang;
  t: Strings;
  dir: Dir;
  /** Locales this venue enabled that the app also has copy for. Falls
   *  back to all five until the menu has loaded. */
  available: readonly Lang[];
  setLang: (lang: Lang) => void;
  /** Called once the menu is known, so the picker and the device default
   *  can be narrowed to what the restaurant actually serves. */
  applyVenueLocales: (venue: VenueLocales) => void;
}

const I18nContext = createContext<I18nApi | null>(null);
const KEY = "rangla-lang";

/**
 * The device's own language, narrowed to what the venue offers: the
 * first device language present in (enabledLocales ∩ this catalogue),
 * else the venue's default locale when we have copy for it, else
 * English. No AsyncStorage here — this is only the value used until (or
 * unless) the guest picks one explicitly.
 */
export function deviceDefault(pool: readonly Lang[], venueDefault?: string | null): Lang {
  const choices = pool.length > 0 ? pool : LANG_CODES;
  for (const entry of Localization.getLocales()) {
    const match = toLang(entry.languageCode ?? entry.languageTag);
    if (match && choices.includes(match)) return match;
  }
  const fallback = toLang(venueDefault);
  if (fallback && choices.includes(fallback)) return fallback;
  return choices.includes("en") ? "en" : (choices[0] ?? "en");
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  // Synchronous first guess from the device; the persisted choice (async)
  // and then the venue's locale list refine it.
  const [lang, setLangState] = useState<Lang>(() => deviceDefault(LANG_CODES));
  const [available, setAvailable] = useState<readonly Lang[]>(LANG_CODES);
  /** True once the guest has an explicit stored preference — the venue
   *  list may then only override it if that language is switched off. */
  const chosen = useRef(false);
  /** The persisted choice has been read; before that, nothing may
   *  overwrite `lang` or we'd race the guest's own preference. */
  const [booted, setBooted] = useState(false);
  const venueRef = useRef<VenueLocales | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (isLang(saved)) {
          chosen.current = true;
          setLangState(saved);
        }
      })
      .catch(() => {})
      .finally(() => setBooted(true));
  }, []);

  // Layout direction is a NATIVE, process-wide setting: changing it only
  // takes effect after a reload, so flip it and restart. `allowRTL` has
  // to be called before any forceRTL for the flag to stick.
  useEffect(() => {
    const dir = dirOf(lang);
    I18nManager.allowRTL(true);
    if ((dir === "rtl") === I18nManager.isRTL) return;
    I18nManager.forceRTL(dir === "rtl");
    void (async () => {
      try {
        // Lazily required: expo-updates is unavailable in some dev
        // setups, and a missing module must not crash the switch.
        const Updates: { reloadAsync?: () => Promise<unknown> } = await import("expo-updates");
        if (!Updates.reloadAsync) throw new Error("no reloadAsync");
        await Updates.reloadAsync();
      } catch {
        // Expo Go / dev client with updates disabled: ask for a manual
        // restart, in the language the guest just picked.
        const copy = STRINGS[lang];
        Alert.alert(copy.restartTitle, copy.restartBody);
      }
    })();
  }, [lang]);

  const resolve = useCallback((venue: VenueLocales) => {
    const enabled = (venue.enabledLocales ?? [])
      .map((code) => toLang(code))
      .filter((code): code is Lang => Boolean(code));
    // Keep the catalogue's own order so the picker never reshuffles, and
    // never end up with an empty list (an old server sends neither field).
    const pool = enabled.length > 0 ? LANG_CODES.filter((c) => enabled.includes(c)) : LANG_CODES;
    setAvailable((current) =>
      current.length === pool.length && current.every((c, i) => c === pool[i]) ? current : pool,
    );
    setLangState((current) =>
      // An explicit choice wins — unless the restaurant switched that
      // language off, in which case fall back rather than show gaps.
      chosen.current && pool.includes(current) ? current : deviceDefault(pool, venue.defaultLocale),
    );
  }, []);

  const applyVenueLocales = useCallback(
    (venue: VenueLocales) => {
      venueRef.current = venue;
      if (booted) resolve(venue);
    },
    [booted, resolve],
  );

  // The menu can arrive before the persisted choice does — replay it.
  useEffect(() => {
    if (booted && venueRef.current) resolve(venueRef.current);
  }, [booted, resolve]);

  const api = useMemo<I18nApi>(
    () => ({
      lang,
      t: STRINGS[lang],
      dir: dirOf(lang),
      available,
      setLang: (next) => {
        chosen.current = true;
        setLangState(next);
        AsyncStorage.setItem(KEY, next).catch(() => {});
      },
      applyVenueLocales,
    }),
    [lang, available, applyVenueLocales],
  );
  return <I18nContext.Provider value={api}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
