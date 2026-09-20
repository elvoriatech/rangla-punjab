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
  rewardPoints: (points: string) => `Reward · ${points} points`,
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

  /* Problem reports — the complaint thread under the tracker. One thread
     per order: the guest opens it, the restaurant answers in the same
     place, and the status line says who is waiting for whom. */
  issue: {
    title: "Something not right?",
    intro: "Tell the restaurant. They see it straight away and answer right here.",
    threadTitle: "Your report",
    bodyLabel: "Your message",
    placeholder: "What went wrong with this order?",
    addPhoto: "Add a photo (optional)",
    photoHint: "JPG, PNG or WebP, up to 5 MB.",
    send: "Send to the restaurant",
    replyLabel: "Your reply",
    replyPlaceholder: "Add something to this report…",
    replySend: "Send reply",
    reportLink: "Report a problem",
    replyLink: "Reply",
    pausedNote: "Live updates are paused while you write.",
    backToTracking: "Back to live tracking",
    youLabel: "You",
    restaurantLabel: "Restaurant",
    photoAlt: (who: string) => `Photo attached by ${who}`,
    statusLabels: {
      open: "Waiting for the restaurant",
      answered: "The restaurant replied",
      resolved: "Resolved",
    },
    sent: "Thank you — your message is with the restaurant.",
    windowClosed:
      "The time for reporting a problem with this order has passed — please call the restaurant.",
    resolvedNote:
      "The restaurant marked this report as resolved. Please call them if something is still wrong.",
    errors: {
      invalid: "Please write a message first (2000 characters at most).",
      invalidPhoto: "The photo has to be a JPG, PNG or WebP image.",
      tooLarge: "That photo is larger than 5 MB — please send a smaller one.",
      windowClosed: "The time for reporting a problem with this order has passed.",
      resolved: "This report is closed. Please call the restaurant.",
      notFound: "We couldn't find this order.",
      failed: "Your message didn't go through — please try again.",
    },
  },

  /* Cancelled order (P7-17). The tracker shows this INSTEAD of the step
     rail: a cancelled order never walked the chain, and a half-lit rail
     would read as "still coming". */
  cancelledTitle: "This order was cancelled",
  cancelledBody:
    "The restaurant called this order off, so nothing is being prepared. If you already paid, the restaurant will refund you — give them a call if anything is unclear.",

  /* "Rate us on Google" — shown on a FINISHED order only, never while the
     food is still coming: asking for a review before the guest has eaten
     is asking them to rate a promise. `newTab` is read by screen readers
     only, because this is the one link on the page that leaves it. */
  /* The required-field convention (`src/components/required-mark.tsx`):
     the star's spoken form, and the one line that explains it per form. */
  required: {
    mark: "(required)",
    legend: "* required field",
  },

  review: {
    title: "How was it?",
    cta: "Rate us on Google ★",
    newTab: "opens Google in a new tab",
    /** The account page's order row, where the label sits beside
     *  "Track" and "Receipt" and has to stay short. */
    short: "Rate on Google",
  },

  /* The restaurant's own numbers on the account page. The card is absent
     entirely when the owner has published none, so no line here ever has
     to say "no phone number". */
  contact: {
    title: "Contact the restaurant",
    intro: "Questions about an order, or a table for tonight? Reach us directly.",
    landline: "Call landline",
    mobile: "Call mobile",
    whatsapp: "WhatsApp",
    whatsappAria: (number: string): string => `Message ${number} on WhatsApp (opens WhatsApp)`,
  },

  /* Guest password reset (P7-15): the "forgot" form, the page the emailed
     link opens, and the two lines that report the outcome — on the
     account page and on the app hand-over page. Every sentence has to
     work for someone who is half sure they even have an account here. */
  password: {
    forgotLink: "Forgot your password?",
    forgotTitle: "Forgot your password?",
    forgotIntro:
      "Type the email address you order with and we'll send you a link to choose a new password.",
    emailLabel: "Email",
    sendLink: "Send me a link",
    sent: "If an account exists for that address, the link is on its way. It works once and expires in 60 minutes.",
    resetTitle: "Choose a new password",
    resetIntro:
      "Pick a password of at least 8 characters. Choosing it signs you out on every other device.",
    newLabel: "New password",
    confirmLabel: "Repeat the password",
    save: "Save the new password",
    changedTitle: "Password changed",
    changedBody: "Your password is changed — please sign in with the new one.",
    backToAccount: "Back to my account",
    backToSignIn: "Back to sign in",
    errors: {
      invalid: "Please choose a password of at least 8 characters.",
      mismatch: "The two passwords didn't match — please type them again.",
      expired: "This link has already been used, or it expired. Please ask for a new one.",
      failed: "That didn't work — please try again.",
    },
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
  rewardPoints: (points) => `Gutschein · ${points} Punkte`,
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

  issue: {
    title: "Stimmt etwas nicht?",
    intro: "Sagen Sie es dem Restaurant. Es sieht Ihre Nachricht sofort und antwortet hier.",
    threadTitle: "Ihre Meldung",
    bodyLabel: "Ihre Nachricht",
    placeholder: "Was ist mit dieser Bestellung schiefgelaufen?",
    addPhoto: "Foto hinzufügen (optional)",
    photoHint: "JPG, PNG oder WebP, bis 5 MB.",
    send: "An das Restaurant senden",
    replyLabel: "Ihre Antwort",
    replyPlaceholder: "Etwas zu dieser Meldung ergänzen…",
    replySend: "Antwort senden",
    reportLink: "Problem melden",
    replyLink: "Antworten",
    pausedNote: "Die Live-Aktualisierung pausiert, solange Sie schreiben.",
    backToTracking: "Zurück zur Live-Verfolgung",
    youLabel: "Sie",
    restaurantLabel: "Restaurant",
    photoAlt: (who) => `Foto von ${who}`,
    statusLabels: {
      open: "Warten auf das Restaurant",
      answered: "Das Restaurant hat geantwortet",
      resolved: "Erledigt",
    },
    sent: "Danke — Ihre Nachricht liegt beim Restaurant.",
    windowClosed:
      "Die Frist, ein Problem zu dieser Bestellung zu melden, ist abgelaufen — bitte rufen Sie das Restaurant an.",
    resolvedNote:
      "Das Restaurant hat diese Meldung als erledigt markiert. Bitte rufen Sie an, falls noch etwas offen ist.",
    errors: {
      invalid: "Bitte schreiben Sie zuerst eine Nachricht (höchstens 2000 Zeichen).",
      invalidPhoto: "Das Foto muss ein JPG-, PNG- oder WebP-Bild sein.",
      tooLarge: "Dieses Foto ist größer als 5 MB — bitte senden Sie ein kleineres.",
      windowClosed: "Die Frist, ein Problem zu dieser Bestellung zu melden, ist abgelaufen.",
      resolved: "Diese Meldung ist abgeschlossen. Bitte rufen Sie das Restaurant an.",
      notFound: "Diese Bestellung wurde nicht gefunden.",
      failed: "Ihre Nachricht wurde nicht gesendet — bitte erneut versuchen.",
    },
  },

  cancelledTitle: "Diese Bestellung wurde storniert",
  cancelledBody:
    "Das Restaurant hat diese Bestellung storniert — es wird nichts zubereitet. Falls Sie bereits bezahlt haben, erstattet Ihnen das Restaurant den Betrag. Rufen Sie bei Fragen einfach an.",

  required: {
    mark: "(Pflichtfeld)",
    legend: "* Pflichtfeld",
  },

  review: {
    title: "Wie war es?",
    cta: "Bewerten Sie uns bei Google ★",
    newTab: "öffnet Google in einem neuen Tab",
    short: "Bei Google bewerten",
  },

  contact: {
    title: "Restaurant kontaktieren",
    intro: "Fragen zu einer Bestellung oder ein Tisch für heute Abend? Melden Sie sich direkt.",
    landline: "Festnetz anrufen",
    mobile: "Mobil anrufen",
    whatsapp: "WhatsApp",
    whatsappAria: (number) => `${number} über WhatsApp anschreiben (öffnet WhatsApp)`,
  },

  password: {
    forgotLink: "Passwort vergessen?",
    forgotTitle: "Passwort vergessen?",
    forgotIntro:
      "Geben Sie die E-Mail-Adresse ein, mit der Sie bestellen — wir schicken Ihnen einen Link für ein neues Passwort.",
    emailLabel: "E-Mail",
    sendLink: "Link schicken",
    sent: "Falls es zu dieser Adresse ein Konto gibt, ist der Link unterwegs. Er funktioniert einmal und läuft nach 60 Minuten ab.",
    resetTitle: "Neues Passwort wählen",
    resetIntro:
      "Wählen Sie ein Passwort mit mindestens 8 Zeichen. Damit werden Sie auf allen anderen Geräten abgemeldet.",
    newLabel: "Neues Passwort",
    confirmLabel: "Passwort wiederholen",
    save: "Neues Passwort speichern",
    changedTitle: "Passwort geändert",
    changedBody: "Ihr Passwort wurde geändert — bitte melden Sie sich mit dem neuen an.",
    backToAccount: "Zurück zu meinem Konto",
    backToSignIn: "Zurück zur Anmeldung",
    errors: {
      invalid: "Bitte wählen Sie ein Passwort mit mindestens 8 Zeichen.",
      mismatch: "Die beiden Passwörter stimmen nicht überein — bitte erneut eingeben.",
      expired:
        "Dieser Link wurde bereits benutzt oder ist abgelaufen. Bitte fordern Sie einen neuen an.",
      failed: "Das hat nicht geklappt — bitte erneut versuchen.",
    },
  },
};

/** French addresses the guest formally ("vous"), the register a French
 *  restaurant uses with its guests. French punctuation wants a space
 *  before « : ; ! ? » — a plain U+0020, never a narrow no-break space,
 *  so the string stays predictable in tests and in the PDF. */
const fr: PostOrderCopy = {
  trackTitle: "Suivre votre commande",
  orderHeading: (n) => `Commande n° ${n}`,
  tableSuffix: (table) => ` · Table ${table}`,
  steps: {
    confirmed: "Confirmée",
    preparing: "En préparation",
    ready: "Prête",
    readyForPickup: "Prête à emporter",
    onTheWay: "En route",
    served: "Servie",
    pickedUp: "Retirée",
    delivered: "Livrée",
  },
  reward: "Bon",
  rewardPoints: (points) => `Bon · ${points} points`,
  total: "Total",
  payment: "Paiement",
  paidOnline: "✓ Payée en ligne",
  paidWithReward: "✓ Payée avec votre bon",
  payAtRestaurant: "Paiement au restaurant",
  autoRefresh: "Cette page s'actualise automatiquement toutes les 15 secondes.",
  backToMenu: "Retour à la carte",

  net: "Montant HT",
  vatLine: (rate) => `TVA ${rate} % (incluse)`,
  paid: "Payée ✓",
  showAtRestaurant:
    "Présentez cet écran au restaurant si besoin : la cuisine voit la commande comme payée.",
  backToApp: "Retour à l'appli",
  signedIn: "Vous êtes connecté",
  closeWindow: "Vous pouvez fermer cette fenêtre.",
  downloadReceipt: "Télécharger le reçu (PDF)",
  // ASCII on purpose: this lands in a file name, so "reçu" is out.
  receiptFilePrefix: "ticket",
  paused: "Commandes suspendues",
  pausedBody:
    "Les paiements en ligne sont suspendus pour l'instant. Merci de régler au restaurant ou de réessayer plus tard.",
  incompleteLink:
    "Ce lien de paiement est incomplet — merci de recommencer depuis la confirmation de votre commande.",
  payAmount: (amount) => `Payer ${amount}`,
  processing: "Traitement en cours…",
  payFailed: "Le paiement n'a pas abouti — merci de réessayer.",
  testPayPage: "Page de paiement de test — en production, Stripe héberge cette étape",
  payWithPaypal: "Payer avec PayPal",
  openingPaypal: "Ouverture de PayPal…",
  paypalFailed: "PayPal n'a pas démarré — merci de réessayer.",
  reservationsTitle: "Mes réservations",
  reservationsEmpty: "Aucune demande de table avec ce compte pour le moment.",
  reservationGuestsOne: "1 personne",
  reservationGuestsMany: (n) => `${n} personnes`,
  reservationRequestedOn: (when) => `Demandée le ${when}`,
  reservationNote: "Remarque",
  reservationStatus: {
    requested: "En attente de confirmation",
    confirmed: "Confirmée",
    declined: "Refusée",
    cancelled: "Annulée",
  },
  reservationHint: {
    requested: "Le restaurant vous appellera pour confirmer cette table.",
    confirmed: "Votre table est réservée — à très bientôt.",
    declined: "Le restaurant n'a pas pu retenir ce créneau. Merci d'en choisir un autre.",
    cancelled: "Cette réservation a été annulée.",
  },

  issue: {
    title: "Un souci avec votre commande ?",
    intro: "Dites-le au restaurant. Il le voit aussitôt et vous répond ici même.",
    threadTitle: "Votre signalement",
    bodyLabel: "Votre message",
    placeholder: "Qu'est-ce qui n'a pas été avec cette commande ?",
    addPhoto: "Ajouter une photo (facultatif)",
    photoHint: "JPG, PNG ou WebP, jusqu'à 5 Mo.",
    send: "Envoyer au restaurant",
    replyLabel: "Votre réponse",
    replyPlaceholder: "Ajouter quelque chose à ce signalement…",
    replySend: "Envoyer la réponse",
    reportLink: "Signaler un problème",
    replyLink: "Répondre",
    pausedNote: "L'actualisation automatique est suspendue pendant que vous écrivez.",
    backToTracking: "Retour au suivi en direct",
    youLabel: "Vous",
    restaurantLabel: "Restaurant",
    photoAlt: (who) => `Photo envoyée par ${who}`,
    statusLabels: {
      open: "En attente du restaurant",
      answered: "Le restaurant a répondu",
      resolved: "Résolu",
    },
    sent: "Merci — votre message est bien arrivé au restaurant.",
    windowClosed:
      "Le délai pour signaler un problème sur cette commande est écoulé — merci d'appeler le restaurant.",
    resolvedNote:
      "Le restaurant a marqué ce signalement comme résolu. Appelez-le si quelque chose ne va toujours pas.",
    errors: {
      invalid: "Merci d'écrire d'abord un message (2000 caractères maximum).",
      invalidPhoto: "La photo doit être une image JPG, PNG ou WebP.",
      tooLarge: "Cette photo dépasse 5 Mo — merci d'en envoyer une plus légère.",
      windowClosed: "Le délai pour signaler un problème sur cette commande est écoulé.",
      resolved: "Ce signalement est clos. Merci d'appeler le restaurant.",
      notFound: "Nous n'avons pas trouvé cette commande.",
      failed: "Votre message n'est pas parti — merci de réessayer.",
    },
  },

  cancelledTitle: "Cette commande a été annulée",
  cancelledBody:
    "Le restaurant a annulé cette commande : rien n'est en préparation. Si vous aviez déjà payé, le restaurant vous remboursera — appelez-le si quelque chose n'est pas clair.",

  required: {
    mark: "(obligatoire)",
    legend: "* champ obligatoire",
  },

  review: {
    title: "Alors, c'était comment ?",
    cta: "Donnez-nous votre avis sur Google ★",
    newTab: "ouvre Google dans un nouvel onglet",
    short: "Avis sur Google",
  },

  contact: {
    title: "Contacter le restaurant",
    intro: "Une question sur une commande, ou une table pour ce soir ? Appelez-nous directement.",
    landline: "Appeler le fixe",
    mobile: "Appeler le mobile",
    whatsapp: "WhatsApp",
    whatsappAria: (number) => `Écrire au ${number} sur WhatsApp (ouvre WhatsApp)`,
  },

  password: {
    forgotLink: "Mot de passe oublié ?",
    forgotTitle: "Mot de passe oublié ?",
    forgotIntro:
      "Indiquez l'adresse e-mail avec laquelle vous commandez : nous vous enverrons un lien pour choisir un nouveau mot de passe.",
    emailLabel: "E-mail",
    sendLink: "Envoyez-moi le lien",
    sent: "Si un compte existe pour cette adresse, le lien est déjà en route. Il ne fonctionne qu'une seule fois et expire au bout de 60 minutes.",
    resetTitle: "Choisir un nouveau mot de passe",
    resetIntro:
      "Choisissez un mot de passe d'au moins 8 caractères. L'enregistrer vous déconnecte de tous vos autres appareils.",
    newLabel: "Nouveau mot de passe",
    confirmLabel: "Répétez le mot de passe",
    save: "Enregistrer le nouveau mot de passe",
    changedTitle: "Mot de passe modifié",
    changedBody: "Votre mot de passe a été modifié — connectez-vous avec le nouveau.",
    backToAccount: "Retour à mon compte",
    backToSignIn: "Retour à la connexion",
    errors: {
      invalid: "Choisissez un mot de passe d'au moins 8 caractères.",
      mismatch: "Les deux mots de passe ne correspondent pas — merci de les saisir à nouveau.",
      expired: "Ce lien a déjà été utilisé, ou il a expiré. Merci d'en demander un nouveau.",
      failed: "Cela n'a pas fonctionné — merci de réessayer.",
    },
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
  rewardPoints: (points) => `Vale · ${points} puntos`,
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

  issue: {
    title: "¿Algo no está bien?",
    intro: "Díselo al restaurante. Lo ve al instante y te responde aquí mismo.",
    threadTitle: "Tu aviso",
    bodyLabel: "Tu mensaje",
    placeholder: "¿Qué ha ido mal con este pedido?",
    addPhoto: "Añadir una foto (opcional)",
    photoHint: "JPG, PNG o WebP, hasta 5 MB.",
    send: "Enviar al restaurante",
    replyLabel: "Tu respuesta",
    replyPlaceholder: "Añade algo a este aviso…",
    replySend: "Enviar respuesta",
    reportLink: "Informar de un problema",
    replyLink: "Responder",
    pausedNote: "La actualización automática está en pausa mientras escribes.",
    backToTracking: "Volver al seguimiento en vivo",
    youLabel: "Tú",
    restaurantLabel: "Restaurante",
    photoAlt: (who) => `Foto enviada por ${who}`,
    statusLabels: {
      open: "Esperando al restaurante",
      answered: "El restaurante ha respondido",
      resolved: "Resuelto",
    },
    sent: "Gracias: el restaurante ya tiene tu mensaje.",
    windowClosed:
      "El plazo para avisar de un problema con este pedido ha terminado: llama al restaurante.",
    resolvedNote:
      "El restaurante ha marcado este aviso como resuelto. Llámales si sigue habiendo algo mal.",
    errors: {
      invalid: "Escribe primero un mensaje (2000 caracteres como máximo).",
      invalidPhoto: "La foto tiene que ser una imagen JPG, PNG o WebP.",
      tooLarge: "Esa foto pesa más de 5 MB: envía una más pequeña.",
      windowClosed: "El plazo para avisar de un problema con este pedido ha terminado.",
      resolved: "Este aviso está cerrado. Llama al restaurante.",
      notFound: "No hemos encontrado este pedido.",
      failed: "Tu mensaje no se ha enviado: inténtalo de nuevo.",
    },
  },

  cancelledTitle: "Este pedido se ha cancelado",
  cancelledBody:
    "El restaurante ha cancelado este pedido, así que no se preparará nada. Si ya habías pagado, el restaurante te devolverá el importe. Llámales si tienes cualquier duda.",

  required: {
    mark: "(obligatorio)",
    legend: "* campo obligatorio",
  },

  review: {
    title: "¿Qué tal ha ido?",
    cta: "Valóranos en Google ★",
    newTab: "abre Google en una pestaña nueva",
    short: "Valorar en Google",
  },

  contact: {
    title: "Contactar con el restaurante",
    intro: "¿Dudas sobre un pedido o una mesa para esta noche? Escríbenos o llámanos.",
    landline: "Llamar al fijo",
    mobile: "Llamar al móvil",
    whatsapp: "WhatsApp",
    whatsappAria: (number) => `Escribir al ${number} por WhatsApp (abre WhatsApp)`,
  },

  password: {
    forgotLink: "¿Has olvidado la contraseña?",
    forgotTitle: "¿Has olvidado la contraseña?",
    forgotIntro:
      "Escribe el correo con el que haces los pedidos y te enviaremos un enlace para elegir una contraseña nueva.",
    emailLabel: "Correo electrónico",
    sendLink: "Enviarme el enlace",
    sent: "Si existe una cuenta con esa dirección, el enlace ya está en camino. Sirve una sola vez y caduca en 60 minutos.",
    resetTitle: "Elige una nueva contraseña",
    resetIntro:
      "Elige una contraseña de al menos 8 caracteres. Al guardarla se cierra tu sesión en los demás dispositivos.",
    newLabel: "Nueva contraseña",
    confirmLabel: "Repite la contraseña",
    save: "Guardar la nueva contraseña",
    changedTitle: "Contraseña cambiada",
    changedBody: "Tu contraseña se ha cambiado: inicia sesión con la nueva.",
    backToAccount: "Volver a mi cuenta",
    backToSignIn: "Volver al inicio de sesión",
    errors: {
      invalid: "Elige una contraseña de al menos 8 caracteres.",
      mismatch: "Las dos contraseñas no coinciden: escríbelas de nuevo.",
      expired: "Este enlace ya se ha usado o ha caducado. Pide uno nuevo.",
      failed: "No ha funcionado: inténtalo de nuevo.",
    },
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
  rewardPoints: (points) => `Buono · ${points} punti`,
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

  issue: {
    title: "Qualcosa non va?",
    intro: "Dillo al ristorante. Lo vede subito e ti risponde qui.",
    threadTitle: "La tua segnalazione",
    bodyLabel: "Il tuo messaggio",
    placeholder: "Che cosa è andato storto con questo ordine?",
    addPhoto: "Aggiungi una foto (facoltativo)",
    photoHint: "JPG, PNG o WebP, fino a 5 MB.",
    send: "Invia al ristorante",
    replyLabel: "La tua risposta",
    replyPlaceholder: "Aggiungi qualcosa a questa segnalazione…",
    replySend: "Invia la risposta",
    reportLink: "Segnala un problema",
    replyLink: "Rispondi",
    pausedNote: "Gli aggiornamenti automatici sono in pausa mentre scrivi.",
    backToTracking: "Torna al monitoraggio in tempo reale",
    youLabel: "Tu",
    restaurantLabel: "Ristorante",
    photoAlt: (who) => `Foto inviata da ${who}`,
    statusLabels: {
      open: "In attesa del ristorante",
      answered: "Il ristorante ha risposto",
      resolved: "Risolta",
    },
    sent: "Grazie: il ristorante ha ricevuto il tuo messaggio.",
    windowClosed:
      "Il tempo per segnalare un problema su questo ordine è scaduto: chiama il ristorante.",
    resolvedNote:
      "Il ristorante ha segnato questa segnalazione come risolta. Chiamali se qualcosa non va ancora.",
    errors: {
      invalid: "Scrivi prima un messaggio (al massimo 2000 caratteri).",
      invalidPhoto: "La foto deve essere un'immagine JPG, PNG o WebP.",
      tooLarge: "Questa foto supera i 5 MB: inviane una più piccola.",
      windowClosed: "Il tempo per segnalare un problema su questo ordine è scaduto.",
      resolved: "Questa segnalazione è chiusa. Chiama il ristorante.",
      notFound: "Non abbiamo trovato questo ordine.",
      failed: "Il messaggio non è stato inviato: riprova.",
    },
  },

  cancelledTitle: "Questo ordine è stato annullato",
  cancelledBody:
    "Il ristorante ha annullato questo ordine: non verrà preparato nulla. Se avevi già pagato, il ristorante ti rimborserà. Chiamali se qualcosa non ti è chiaro.",

  required: {
    mark: "(obbligatorio)",
    legend: "* campo obbligatorio",
  },

  review: {
    title: "Com'è andata?",
    cta: "Valutaci su Google ★",
    newTab: "apre Google in una nuova scheda",
    short: "Valuta su Google",
  },

  contact: {
    title: "Contatta il ristorante",
    intro: "Domande su un ordine o un tavolo per stasera? Scrivici o chiamaci.",
    landline: "Chiama il fisso",
    mobile: "Chiama il cellulare",
    whatsapp: "WhatsApp",
    whatsappAria: (number) => `Scrivi al ${number} su WhatsApp (apre WhatsApp)`,
  },

  password: {
    forgotLink: "Password dimenticata?",
    forgotTitle: "Password dimenticata?",
    forgotIntro:
      "Scrivi l'indirizzo email con cui ordini e ti inviamo un link per scegliere una nuova password.",
    emailLabel: "Email",
    sendLink: "Inviami il link",
    sent: "Se esiste un account con quell'indirizzo, il link è in arrivo. Funziona una volta sola e scade dopo 60 minuti.",
    resetTitle: "Scegli una nuova password",
    resetIntro:
      "Scegli una password di almeno 8 caratteri. Salvandola esci da tutti gli altri dispositivi.",
    newLabel: "Nuova password",
    confirmLabel: "Ripeti la password",
    save: "Salva la nuova password",
    changedTitle: "Password cambiata",
    changedBody: "La tua password è stata cambiata: accedi con quella nuova.",
    backToAccount: "Torna al mio account",
    backToSignIn: "Torna all'accesso",
    errors: {
      invalid: "Scegli una password di almeno 8 caratteri.",
      mismatch: "Le due password non coincidono: riscrivile.",
      expired: "Questo link è già stato usato oppure è scaduto. Richiedine uno nuovo.",
      failed: "Non ha funzionato: riprova.",
    },
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
  rewardPoints: (points) => `قسيمة · ${points} نقطة`,
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

  issue: {
    title: "هل هناك خطأ ما؟",
    intro: "أخبر المطعم. سيرى رسالتك فورًا ويردّ عليك هنا.",
    threadTitle: "بلاغك",
    bodyLabel: "رسالتك",
    placeholder: "ما الذي حدث في هذا الطلب؟",
    addPhoto: "إضافة صورة (اختياري)",
    photoHint: "JPG أو PNG أو WebP، حتى 5 ميغابايت.",
    send: "إرسال إلى المطعم",
    replyLabel: "ردّك",
    replyPlaceholder: "أضف شيئًا إلى هذا البلاغ…",
    replySend: "إرسال الرد",
    reportLink: "الإبلاغ عن مشكلة",
    replyLink: "الرد",
    pausedNote: "التحديث التلقائي متوقف مؤقتًا أثناء الكتابة.",
    backToTracking: "العودة إلى التتبّع المباشر",
    youLabel: "أنت",
    restaurantLabel: "المطعم",
    photoAlt: (who) => `صورة أرسلها ${who}`,
    statusLabels: {
      open: "في انتظار ردّ المطعم",
      answered: "ردّ المطعم",
      resolved: "تم الحل",
    },
    sent: "شكرًا — وصلت رسالتك إلى المطعم.",
    windowClosed: "انتهت مهلة الإبلاغ عن مشكلة في هذا الطلب — يُرجى الاتصال بالمطعم.",
    resolvedNote: "اعتبر المطعم هذا البلاغ منتهيًا. اتصل بهم إذا بقي شيء غير صحيح.",
    errors: {
      invalid: "اكتب رسالة أولًا (2000 حرف كحد أقصى).",
      invalidPhoto: "يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP.",
      tooLarge: "حجم هذه الصورة يتجاوز 5 ميغابايت — أرسل صورة أصغر.",
      windowClosed: "انتهت مهلة الإبلاغ عن مشكلة في هذا الطلب.",
      resolved: "هذا البلاغ مغلق. يُرجى الاتصال بالمطعم.",
      notFound: "لم نعثر على هذا الطلب.",
      failed: "لم تُرسل رسالتك — حاول مرة أخرى.",
    },
  },

  cancelledTitle: "تم إلغاء هذا الطلب",
  cancelledBody:
    "ألغى المطعم هذا الطلب، ولن يتم تحضير أي شيء. إذا كنت قد دفعت بالفعل، فسيردّ لك المطعم المبلغ. اتصل بهم إذا كان لديك أي استفسار.",

  required: {
    mark: "(حقل مطلوب)",
    legend: "* حقل مطلوب",
  },

  review: {
    title: "كيف كانت تجربتك؟",
    cta: "قيّمنا على Google ★",
    newTab: "يفتح Google في تبويب جديد",
    short: "التقييم على Google",
  },

  contact: {
    title: "تواصلوا مع المطعم",
    intro: "لديكم سؤال عن طلب أو تريدون طاولة الليلة؟ تواصلوا معنا مباشرةً.",
    landline: "اتصال بالهاتف الأرضي",
    mobile: "اتصال بالجوال",
    whatsapp: "واتساب",
    whatsappAria: (number) => `مراسلة ${number} عبر واتساب (يفتح واتساب)`,
  },

  password: {
    forgotLink: "نسيت كلمة المرور؟",
    forgotTitle: "نسيت كلمة المرور؟",
    forgotIntro: "اكتب البريد الإلكتروني الذي تطلب به، وسنرسل لك رابطًا لاختيار كلمة مرور جديدة.",
    emailLabel: "البريد الإلكتروني",
    sendLink: "أرسل لي الرابط",
    sent: "إن كان هناك حساب بهذا العنوان، فالرابط في طريقه إليك. يعمل مرة واحدة وتنتهي صلاحيته بعد 60 دقيقة.",
    resetTitle: "اختر كلمة مرور جديدة",
    resetIntro:
      "اختر كلمة مرور من 8 أحرف على الأقل. سيؤدي حفظها إلى تسجيل خروجك من جميع الأجهزة الأخرى.",
    newLabel: "كلمة المرور الجديدة",
    confirmLabel: "أعد كتابة كلمة المرور",
    save: "حفظ كلمة المرور الجديدة",
    changedTitle: "تم تغيير كلمة المرور",
    changedBody: "تم تغيير كلمة مرورك — سجّل الدخول بالكلمة الجديدة.",
    backToAccount: "العودة إلى حسابي",
    backToSignIn: "العودة إلى تسجيل الدخول",
    errors: {
      invalid: "اختر كلمة مرور من 8 أحرف على الأقل.",
      mismatch: "كلمتا المرور غير متطابقتين — أعد كتابتهما.",
      expired: "استُخدم هذا الرابط من قبل أو انتهت صلاحيته. اطلب رابطًا جديدًا.",
      failed: "لم تنجح العملية — حاول مرة أخرى.",
    },
  },
};

export const POST_ORDER_COPY: Record<UiLocale, PostOrderCopy> = { de, en, fr, es, it, ar };

/** Post-order copy for a venue/route locale (region tags collapse, unknown
 *  codes fall back to English). */
export const postOrderCopy = (locale?: string | null): PostOrderCopy =>
  POST_ORDER_COPY[uiLocale(locale)];
