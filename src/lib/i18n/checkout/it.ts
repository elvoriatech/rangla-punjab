/** Guest checkout copy — Italian (Italiano). Loaded on its own chunk by
 *  `./load.ts`; `en.ts` supplies the shape (type-only import, so no
 *  English strings ride along). */
import type { CheckoutCopy } from "./en";

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

  addressTitle: "Indirizzo di consegna",
  addressChange: "Modifica",

  timeNow: "Subito",
  timeScheduled: "Programmato",
  timeEarlier: "Prima",
  timeLater: "Dopo",

  freeDeliveryHere: "Consegna gratuita in questa zona 🎉",
  freeDeliveryFrom: (amount) => `Consegna gratuita da ${amount}`,
  deliveryFee: (fee) => `Costo di consegna ${fee}`,
  minimumOrderSuffix: (min) => ` · ordine minimo ${min}`,
  minimumOrder: (min) => `Ordine minimo ${min}`,
  belowMinimum: (min, missing) => `La consegna parte da ${min}: mancano ${missing}.`,

  payGroup: "Ordina e paga",
  paymentMethod: "Pagamento",
  payOrChoose: "oppure scegli un altro modo di pagare",
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
  errWalletPay:
    "Il pagamento con il wallet non è andato a buon fine: il tuo ordine è salvato; scegli qui sotto un altro modo di pagare.",
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

export default it;
