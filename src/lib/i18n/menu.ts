import { uiLocale, type UiLocale } from "@/lib/locales";

/**
 * Guest-copy catalogue for the public menu chrome — everything the
 * restaurant itself does not author (dish names, descriptions and
 * category names come from the venue's own `Translation` rows).
 *
 * No i18n runtime (CLAUDE.md): this is a plain object per locale.
 * English is the shape, so `MenuCopy = typeof en` makes TypeScript
 * refuse a locale that forgets a key, and `menu-view.test.tsx` adds a
 * runtime check that none of them is blank.
 *
 * Keys that take values are FUNCTIONS, never templates with positional
 * markers: word order differs per language and `${}` is the only
 * interpolation that survives a translator moving the slot.
 */

/** Diet ids come from `dietary-filter.ts` (+ the optional halal filter). */
type DietLabels = {
  vegan: string;
  vegetarian: string;
  gluten_free: string;
  dairy_free: string;
  halal: string;
  kosher: string;
};

type Feature = { title: string; sub: string };

const en = {
  nav: {
    categories: "Categories",
    dietaryFilter: "Dietary filter",
    language: "Language",
    all: "All",
    allDiets: "All diets",
  },
  /** P7-12 — the "Offers" destination: a synthetic first section listing
   *  every dish whose offer is active, plus its own tab on the category
   *  rail. Nothing here renders when the venue has no live offer. */
  offers: {
    /** Heading of the synthetic section. */
    title: "Offers",
    /** Label on the category rail (first tab). */
    tab: "Offers",
    /** Read out before the section's dishes. */
    count: (n: number): string => (n === 1 ? "1 dish on offer" : `${n} dishes on offer`),
  },
  badges: {
    open: "Open",
    /** Suffix of the open pill: "Open · until 22:00". */
    until: (time: string): string => `until ${time}`,
    closed: "Closed",
    opensAt: (day: string, time: string): string => `Opens ${day} ${time}`,
    unavailable: "unavailable",
    offer: "Offer",
    /** Screen-reader prefixes around a struck-through original price. */
    regularPrice: "regular price",
    offerPrice: "offer price",
    price: "price",
    spicyTitle: (level: number): string => `Spicy — level ${level} of 3`,
    spicyLevel: (level: number): string => `Spicy, level ${level} of 3`,
  },
  /** P7-14 — the venue's Google rating under its name. Rendered only when
   *  the owner has set a Place ID and a rating has actually been read, so
   *  none of this ever shows a zero or an empty star. */
  rating: {
    /** Link text after the score: "★ 4.6 (312) · Write a review →". */
    write: "Write a review",
    /** Accessible name for that link — it leaves the site for Google. */
    writeAria: "Write a Google review (opens in a new tab)",
    /** Read out in place of the star + numbers, which mean nothing aloud. */
    summary: (value: string, count: string): string =>
      `Rated ${value} out of 5 from ${count} Google reviews`,
  },
  /**
   * P7-14 follow-up — the first-visit privacy notice on the public menu.
   * Not a cookie banner: the page sets no cookie and loads no third-party
   * script, so there is nothing to consent to. It exists to SAY that, and
   * to point at the policy — which is why the only control is "Got it".
   */
  privacy: {
    title: "Your privacy",
    body: "This menu sets no tracking cookies. Your basket and this choice are saved only on your device.",
    link: "Privacy policy",
    ok: "Got it",
  },
  diets: {
    vegan: "Vegan",
    vegetarian: "Vegetarian",
    gluten_free: "Gluten-free",
    dairy_free: "Dairy-free",
    halal: "Halal",
    kosher: "Kosher",
  } as DietLabels,
  allergens: {
    info: "Allergen information",
    infoFor: (dish: string): string => `Allergen information — ${dish}`,
    heading: "Allergens",
    contains: "Contains",
    traces: "May contain traces of",
    close: "Close",
  },
  dish: {
    more: "More",
    moreAbout: (dish: string): string => `More about ${dish}`,
    close: "Close",
  },
  /* The Complaint button beside "Reserve table" — and what it says when
     this browser has no order to attach a complaint to. */
  complaint: {
    button: "Complaint",
    title: "Raising a complaint",
    body: "Complaints are raised on an order. Open the tracking link in your order confirmation, or place an order first.",
    close: "Close",
  },
  reserve: {
    buttonShort: "Reserve",
    buttonLong: "Reserve a table",
    title: "Reserve a table",
    holdNote: "We hold your table for 15 minutes past the reserved time.",
    close: "Close",
    received: "Request received!",
    confirmByPhone: "The restaurant will confirm your reservation by phone shortly.",
    done: "Done",
    date: "Date",
    time: "Time",
    guests: "Guests",
    name: "Name",
    phone: "Phone",
    note: "Note (optional)",
    select: "Select…",
    pickDateFirst: "Pick a date",
    guestCount: (n: number): string => (n === 1 ? "1 guest" : `${n} guests`),
    notePlaceholder: "Birthday, window seat, stroller…",
    sending: "Sending…",
    submit: "Request reservation",
    noPayment: "No payment needed — the restaurant confirms by phone.",
    errorRateLimited: "Too many requests — please try again in a moment.",
    errorInvalidTime: "That time just became unavailable — please pick another slot.",
    errorGeneric: "Something went wrong — please try again or call us.",
    /** The required-field convention (`src/components/required-mark.tsx`):
     *  the star's spoken form, and the line that explains it once per form. */
    requiredMark: "(required)",
    requiredLegend: "* required field",
  },
  emptyStates: {
    noDishesInSection: "No dishes in this section.",
    noDietMatch: "No dishes match every diet you picked. Uncheck a filter above to see more.",
    emptyMenu: "Nothing on the menu yet — the restaurant is still building it.",
  },
  banners: {
    orderingPaused: "Online ordering is paused right now — please check back soon.",
    draftPreview: "Draft preview — your private link. Guests only see what you publish.",
  },
  footer: {
    poweredBy: (brand: string): string => `Powered by ${brand} · Digital Menus`,
    acceptedPayments: "Accepted payments",
  },
  /** The restaurant's own numbers, in the footer. Rendered only for the
   *  slots the owner has actually filled in, so none of these labels ever
   *  appears next to an empty link. */
  contact: {
    /** Heading of the footer row, and the group's accessible name. */
    title: "Contact us",
    landline: "Call landline",
    mobile: "Call mobile",
    whatsapp: "WhatsApp",
    /** Accessible name of a call link: "Call landline +49 7531 123456". */
    callAria: (label: string, number: string): string => `${label} ${number}`,
    /** WhatsApp leaves the site, so its link says so out loud. */
    whatsappAria: (number: string): string => `Message ${number} on WhatsApp (opens WhatsApp)`,
  },
  /** "Get the app" — the footer section and the compact header link that
   *  jumps to it. Store names ("App Store", "Google Play") are brand names
   *  and stay as they are in every language; everything around them is
   *  translated. Nothing here renders until an owner publishes a link. */
  app: {
    /** Compact header link, beside the open pill. Kept to one word: it
     *  shares a row with the open/closed pill on a 320px phone. */
    navLabel: "App",
    /** Accessible name of that link — it is a jump, not a download. */
    navAria: "Get the app — jump to the download links",
    /** Heading of the footer section, and the group's accessible name. */
    title: "Get the app",
    /** One line under the heading. Why a guest would want it. */
    blurb: "Order in a tap, keep your favourites and follow your order.",
    /** Badge text. Top line is translated, the store name is not, and the
     *  two together are the badge's accessible name. */
    iosTop: "Download on the",
    iosName: "App Store",
    androidTop: "Get it on",
    androidName: "Google Play",
    /** Both badges leave the site, so their links say so out loud. */
    storeAria: (badge: string): string => `${badge} (opens in a new tab)`,
    /** The direct download, for guests with no Play Store on the phone. */
    apk: "Download Android app (.apk)",
    /** Said before they tap, not after: an unexplained Android warning is
     *  what makes someone abandon the install. */
    apkHint: "Android will ask you to allow the install.",
  },
  hero: {
    welcomeAria: "Welcome",
    welcomeTo: "Welcome to",
    tagline: "Cooked fresh, served fast — browse the menu and order straight from your phone.",
    orderNow: "Order now ↓",
    features: [
      { title: "Served fast", sub: "Straight from the kitchen" },
      { title: "Best quality", sub: "Fresh ingredients" },
      { title: "Fair prices", sub: "Every day" },
    ] as Feature[],
    categoriesHeading: "Our categories",
    categoriesAria: "Categories with photos",
    dishCount: (n: number): string => (n === 1 ? "1 dish" : `${n} dishes`),
  },
  metadata: {
    title: (venue: string): string => `${venue} — Menu`,
    description: (venue: string): string =>
      `Menu for ${venue}. See dishes, prices, allergen and dietary information.`,
    srHeading: (venue: string): string => `${venue} menu`,
  },
};

export type MenuCopy = typeof en;

/** German addresses the guest formally ("Sie") — the tone the rest of the
 *  product uses with restaurant guests and owners alike. */
const de: MenuCopy = {
  nav: {
    categories: "Kategorien",
    dietaryFilter: "Ernährungsfilter",
    language: "Sprache",
    all: "Alle",
    allDiets: "Alle Ernährungsformen",
  },
  offers: {
    title: "Angebote",
    tab: "Angebote",
    count: (n) => (n === 1 ? "1 Gericht im Angebot" : `${n} Gerichte im Angebot`),
  },
  badges: {
    open: "Geöffnet",
    until: (time) => `bis ${time}`,
    closed: "Geschlossen",
    opensAt: (day, time) => `Öffnet ${day} ${time}`,
    unavailable: "nicht verfügbar",
    offer: "Angebot",
    regularPrice: "regulärer Preis",
    offerPrice: "Angebotspreis",
    price: "Preis",
    spicyTitle: (level) => `Scharf — Stufe ${level} von 3`,
    spicyLevel: (level) => `Scharf, Stufe ${level} von 3`,
  },
  rating: {
    write: "Bewertung schreiben",
    writeAria: "Eine Google-Bewertung schreiben (öffnet in einem neuen Tab)",
    summary: (value, count) => `Mit ${value} von 5 bewertet, aus ${count} Google-Bewertungen`,
  },
  privacy: {
    title: "Ihre Privatsphäre",
    body: "Diese Speisekarte setzt keine Tracking-Cookies. Ihr Warenkorb und diese Auswahl werden nur auf Ihrem Gerät gespeichert.",
    link: "Datenschutzerklärung",
    ok: "Verstanden",
  },
  diets: {
    vegan: "Vegan",
    vegetarian: "Vegetarisch",
    gluten_free: "Glutenfrei",
    dairy_free: "Milchfrei",
    halal: "Halal",
    kosher: "Koscher",
  },
  allergens: {
    info: "Allergeninformationen",
    infoFor: (dish) => `Allergeninformationen — ${dish}`,
    heading: "Allergene",
    contains: "Enthält",
    traces: "Kann Spuren enthalten von",
    close: "Schließen",
  },
  dish: {
    more: "Mehr",
    moreAbout: (dish) => `Mehr über ${dish}`,
    close: "Schließen",
  },
  /* Der Reklamations-Button neben „Tisch reservieren" – und was er sagt,
     wenn dieser Browser keine Bestellung kennt. */
  complaint: {
    button: "Reklamation",
    title: "Reklamation melden",
    body: "Eine Reklamation gehört zu einer Bestellung. Öffnen Sie den Tracking-Link aus Ihrer Bestellbestätigung oder geben Sie zuerst eine Bestellung auf.",
    close: "Schließen",
  },
  reserve: {
    buttonShort: "Reservieren",
    buttonLong: "Tisch reservieren",
    title: "Tisch reservieren",
    holdNote: "Wir halten Ihren Tisch 15 Minuten über die reservierte Zeit hinaus frei.",
    close: "Schließen",
    received: "Anfrage eingegangen!",
    confirmByPhone: "Das Restaurant bestätigt Ihre Reservierung in Kürze telefonisch.",
    done: "Fertig",
    date: "Datum",
    time: "Uhrzeit",
    guests: "Personen",
    name: "Name",
    phone: "Telefon",
    note: "Anmerkung (optional)",
    select: "Bitte wählen…",
    pickDateFirst: "Erst Datum wählen",
    guestCount: (n) => (n === 1 ? "1 Person" : `${n} Personen`),
    notePlaceholder: "Geburtstag, Fensterplatz, Kinderwagen…",
    sending: "Wird gesendet…",
    submit: "Reservierung anfragen",
    noPayment: "Keine Zahlung nötig — das Restaurant bestätigt telefonisch.",
    errorRateLimited: "Zu viele Anfragen — bitte versuchen Sie es gleich noch einmal.",
    errorInvalidTime: "Diese Uhrzeit ist gerade vergeben — bitte wählen Sie eine andere.",
    errorGeneric: "Etwas ist schiefgelaufen — bitte versuchen Sie es erneut oder rufen Sie uns an.",
    requiredMark: "(Pflichtfeld)",
    requiredLegend: "* Pflichtfeld",
  },
  emptyStates: {
    noDishesInSection: "In diesem Bereich sind noch keine Gerichte.",
    noDietMatch:
      "Keine Gerichte erfüllen alle gewählten Ernährungsformen. Entfernen Sie oben einen Filter, um mehr zu sehen.",
    emptyMenu: "Noch keine Gerichte — das Restaurant stellt die Karte gerade zusammen.",
  },
  banners: {
    orderingPaused:
      "Online-Bestellungen sind gerade pausiert — bitte schauen Sie bald wieder vorbei.",
    draftPreview: "Entwurfsvorschau — Ihr privater Link. Gäste sehen nur, was Sie veröffentlichen.",
  },
  footer: {
    poweredBy: (brand) => `Bereitgestellt von ${brand} · Digitale Speisekarten`,
    acceptedPayments: "Akzeptierte Zahlungsmittel",
  },
  contact: {
    title: "Kontakt",
    landline: "Festnetz anrufen",
    mobile: "Mobil anrufen",
    whatsapp: "WhatsApp",
    callAria: (label, number) => `${label}: ${number}`,
    whatsappAria: (number) => `${number} über WhatsApp anschreiben (öffnet WhatsApp)`,
  },
  app: {
    navLabel: "App",
    navAria: "App holen — zu den Download-Links springen",
    title: "App holen",
    blurb: "Mit einem Tipp bestellen, Favoriten merken und die Bestellung verfolgen.",
    iosTop: "Laden im",
    iosName: "App Store",
    androidTop: "Jetzt bei",
    androidName: "Google Play",
    storeAria: (badge) => `${badge} (öffnet in einem neuen Tab)`,
    apk: "Android-App herunterladen (.apk)",
    apkHint: "Android fragt Sie, ob die Installation erlaubt werden soll.",
  },
  hero: {
    welcomeAria: "Willkommen",
    welcomeTo: "Willkommen bei",
    tagline:
      "Frisch gekocht, schnell serviert — stöbern Sie in der Karte und bestellen Sie direkt vom Handy.",
    orderNow: "Jetzt bestellen ↓",
    features: [
      { title: "Schnell serviert", sub: "Direkt aus der Küche" },
      { title: "Beste Qualität", sub: "Frische Zutaten" },
      { title: "Faire Preise", sub: "Jeden Tag" },
    ],
    categoriesHeading: "Unsere Kategorien",
    categoriesAria: "Kategorien mit Bild",
    dishCount: (n) => (n === 1 ? "1 Gericht" : `${n} Gerichte`),
  },
  metadata: {
    title: (venue) => `${venue} — Speisekarte`,
    description: (venue) =>
      `Speisekarte von ${venue}. Gerichte, Preise, Allergene und Ernährungshinweise auf einen Blick.`,
    srHeading: (venue) => `Speisekarte ${venue}`,
  },
};

/** French addresses the guest formally ("vous"), the register a French
 *  restaurant uses with its guests. French punctuation wants a space
 *  before « : ; ! ? » — a plain U+0020, never a narrow no-break space,
 *  so the string stays predictable in tests and in the PDF. */
const fr: MenuCopy = {
  nav: {
    categories: "Catégories",
    dietaryFilter: "Filtre alimentaire",
    language: "Langue",
    all: "Tout",
    allDiets: "Tous les régimes",
  },
  offers: {
    title: "Offres",
    tab: "Offres",
    count: (n) => (n === 1 ? "1 plat en promotion" : `${n} plats en promotion`),
  },
  badges: {
    open: "Ouvert",
    until: (time) => `jusqu'à ${time}`,
    closed: "Fermé",
    opensAt: (day, time) => `Ouvre ${day} à ${time}`,
    unavailable: "indisponible",
    offer: "Offre",
    regularPrice: "prix habituel",
    offerPrice: "prix promotionnel",
    price: "prix",
    spicyTitle: (level) => `Épicé — niveau ${level} sur 3`,
    spicyLevel: (level) => `Épicé, niveau ${level} sur 3`,
  },
  rating: {
    write: "Laisser un avis",
    writeAria: "Laisser un avis Google (s'ouvre dans un nouvel onglet)",
    summary: (value, count) => `Note de ${value} sur 5, sur ${count} avis Google`,
  },
  privacy: {
    title: "Votre vie privée",
    body: "Cette carte ne dépose aucun cookie de suivi. Votre panier et ce choix sont enregistrés uniquement sur votre appareil.",
    link: "Politique de confidentialité",
    ok: "J'ai compris",
  },
  diets: {
    vegan: "Végan",
    vegetarian: "Végétarien",
    gluten_free: "Sans gluten",
    dairy_free: "Sans produits laitiers",
    halal: "Halal",
    kosher: "Casher",
  },
  allergens: {
    info: "Informations sur les allergènes",
    infoFor: (dish) => `Informations sur les allergènes — ${dish}`,
    heading: "Allergènes",
    contains: "Contient",
    traces: "Peut contenir des traces de",
    close: "Fermer",
  },
  dish: {
    more: "Détails",
    moreAbout: (dish) => `En savoir plus sur ${dish}`,
    close: "Fermer",
  },
  /* Le bouton Réclamation à côté de « Réserver une table » — et ce qu'il
     dit quand ce navigateur ne connaît aucune commande. */
  complaint: {
    button: "Réclamation",
    title: "Faire une réclamation",
    body: "Une réclamation se rattache à une commande. Ouvrez le lien de suivi de votre confirmation de commande, ou passez d'abord une commande.",
    close: "Fermer",
  },
  reserve: {
    buttonShort: "Réserver",
    buttonLong: "Réserver une table",
    title: "Réserver une table",
    holdNote: "Nous gardons votre table pendant 15 minutes après l'heure réservée.",
    close: "Fermer",
    received: "Demande bien reçue !",
    confirmByPhone: "Le restaurant vous confirmera votre réservation par téléphone sous peu.",
    done: "Terminé",
    date: "Date",
    time: "Heure",
    guests: "Convives",
    name: "Nom",
    phone: "Téléphone",
    note: "Remarque (facultatif)",
    select: "Choisir…",
    pickDateFirst: "Choisissez d'abord une date",
    guestCount: (n) => (n === 1 ? "1 personne" : `${n} personnes`),
    notePlaceholder: "Anniversaire, table près de la fenêtre, poussette…",
    sending: "Envoi en cours…",
    submit: "Demander une réservation",
    noPayment: "Aucun paiement requis — le restaurant confirme par téléphone.",
    errorRateLimited: "Trop de demandes — merci de réessayer dans un instant.",
    errorInvalidTime: "Ce créneau vient d'être pris — merci d'en choisir un autre.",
    errorGeneric: "Une erreur est survenue — merci de réessayer ou de nous appeler.",
    requiredMark: "(obligatoire)",
    requiredLegend: "* champ obligatoire",
  },
  emptyStates: {
    noDishesInSection: "Aucun plat dans cette section.",
    noDietMatch:
      "Aucun plat ne correspond à tous les régimes choisis. Décochez un filtre ci-dessus pour en voir davantage.",
    emptyMenu: "La carte n'est pas encore en ligne — le restaurant est en train de la composer.",
  },
  banners: {
    orderingPaused: "La commande en ligne est suspendue pour l'instant — revenez d'ici peu.",
    draftPreview:
      "Aperçu du brouillon — votre lien privé. Les clients ne voient que ce que vous publiez.",
  },
  footer: {
    poweredBy: (brand) => `Propulsé par ${brand} · Cartes numériques`,
    acceptedPayments: "Moyens de paiement acceptés",
  },
  contact: {
    title: "Nous contacter",
    landline: "Appeler le fixe",
    mobile: "Appeler le mobile",
    whatsapp: "WhatsApp",
    callAria: (label, number) => `${label} : ${number}`,
    whatsappAria: (number) => `Écrire au ${number} sur WhatsApp (ouvre WhatsApp)`,
  },
  app: {
    navLabel: "Appli",
    navAria: "Obtenir l'appli — aller aux liens de téléchargement",
    title: "Obtenir l'appli",
    blurb: "Commandez en un geste, gardez vos favoris et suivez votre commande.",
    iosTop: "Disponible sur",
    iosName: "App Store",
    androidTop: "Disponible sur",
    androidName: "Google Play",
    storeAria: (badge) => `${badge} (s'ouvre dans un nouvel onglet)`,
    apk: "Télécharger l'application Android (.apk)",
    apkHint: "Android vous demandera d'autoriser l'installation.",
  },
  hero: {
    welcomeAria: "Bienvenue",
    welcomeTo: "Bienvenue chez",
    tagline:
      "Cuisiné minute, servi sans attendre — parcourez la carte et commandez depuis votre téléphone.",
    orderNow: "Commander ↓",
    features: [
      { title: "Servi sans attendre", sub: "Droit sorti de la cuisine" },
      { title: "Qualité au rendez-vous", sub: "Des produits frais" },
      { title: "Des prix justes", sub: "Tous les jours" },
    ],
    categoriesHeading: "Nos catégories",
    categoriesAria: "Catégories en images",
    dishCount: (n) => (n === 1 ? "1 plat" : `${n} plats`),
  },
  metadata: {
    title: (venue) => `${venue} — Carte`,
    description: (venue) =>
      `Carte de ${venue}. Plats, prix, allergènes et informations sur les régimes alimentaires.`,
    srHeading: (venue) => `Carte de ${venue}`,
  },
};

/** Neutral European Spanish, formal "usted" — a guest is a guest. */
const es: MenuCopy = {
  nav: {
    categories: "Categorías",
    dietaryFilter: "Filtro dietético",
    language: "Idioma",
    all: "Todo",
    allDiets: "Todas las dietas",
  },
  offers: {
    title: "Ofertas",
    tab: "Ofertas",
    count: (n) => (n === 1 ? "1 plato en oferta" : `${n} platos en oferta`),
  },
  badges: {
    open: "Abierto",
    until: (time) => `hasta las ${time}`,
    closed: "Cerrado",
    opensAt: (day, time) => `Abre ${day} a las ${time}`,
    unavailable: "no disponible",
    offer: "Oferta",
    regularPrice: "precio habitual",
    offerPrice: "precio de oferta",
    price: "precio",
    spicyTitle: (level) => `Picante — nivel ${level} de 3`,
    spicyLevel: (level) => `Picante, nivel ${level} de 3`,
  },
  rating: {
    write: "Escribir una reseña",
    writeAria: "Escribir una reseña en Google (se abre en una pestaña nueva)",
    summary: (value, count) =>
      `Valorado con ${value} sobre 5 a partir de ${count} reseñas de Google`,
  },
  privacy: {
    title: "Tu privacidad",
    body: "Esta carta no usa cookies de seguimiento. Tu cesta y esta elección se guardan solo en tu dispositivo.",
    link: "Política de privacidad",
    ok: "Entendido",
  },
  diets: {
    vegan: "Vegano",
    vegetarian: "Vegetariano",
    gluten_free: "Sin gluten",
    dairy_free: "Sin lácteos",
    halal: "Halal",
    kosher: "Kosher",
  },
  allergens: {
    info: "Información de alérgenos",
    infoFor: (dish) => `Información de alérgenos — ${dish}`,
    heading: "Alérgenos",
    contains: "Contiene",
    traces: "Puede contener trazas de",
    close: "Cerrar",
  },
  dish: {
    more: "Más",
    moreAbout: (dish) => `Más sobre ${dish}`,
    close: "Cerrar",
  },
  /* El botón de Reclamación junto a «Reservar mesa», y lo que dice cuando
     este navegador no conoce ningún pedido. */
  complaint: {
    button: "Reclamación",
    title: "Presentar una reclamación",
    body: "Una reclamación va ligada a un pedido. Abre el enlace de seguimiento de tu confirmación de pedido, o haz primero un pedido.",
    close: "Cerrar",
  },
  reserve: {
    buttonShort: "Reservar",
    buttonLong: "Reservar mesa",
    title: "Reservar mesa",
    holdNote: "Mantenemos su mesa durante 15 minutos después de la hora reservada.",
    close: "Cerrar",
    received: "¡Solicitud recibida!",
    confirmByPhone: "El restaurante confirmará su reserva por teléfono en breve.",
    done: "Listo",
    date: "Fecha",
    time: "Hora",
    guests: "Comensales",
    name: "Nombre",
    phone: "Teléfono",
    note: "Nota (opcional)",
    select: "Seleccionar…",
    pickDateFirst: "Elija una fecha",
    guestCount: (n) => (n === 1 ? "1 comensal" : `${n} comensales`),
    notePlaceholder: "Cumpleaños, mesa junto a la ventana, carrito…",
    sending: "Enviando…",
    submit: "Solicitar reserva",
    noPayment: "No hace falta pagar: el restaurante confirma por teléfono.",
    errorRateLimited: "Demasiadas solicitudes: inténtelo de nuevo en un momento.",
    errorInvalidTime: "Esa hora acaba de ocuparse: elija otra franja.",
    errorGeneric: "Algo ha salido mal: inténtelo de nuevo o llámenos.",
    requiredMark: "(obligatorio)",
    requiredLegend: "* campo obligatorio",
  },
  emptyStates: {
    noDishesInSection: "No hay platos en esta sección.",
    noDietMatch:
      "Ningún plato cumple todas las dietas elegidas. Quite un filtro de arriba para ver más.",
    emptyMenu: "La carta aún está vacía: el restaurante la está preparando.",
  },
  banners: {
    orderingPaused: "Los pedidos online están pausados ahora mismo: vuelva a intentarlo pronto.",
    draftPreview:
      "Vista previa del borrador: su enlace privado. Los clientes solo ven lo publicado.",
  },
  footer: {
    poweredBy: (brand) => `Con tecnología de ${brand} · Cartas digitales`,
    acceptedPayments: "Pagos aceptados",
  },
  contact: {
    title: "Contacto",
    landline: "Llamar al fijo",
    mobile: "Llamar al móvil",
    whatsapp: "WhatsApp",
    callAria: (label, number) => `${label}: ${number}`,
    whatsappAria: (number) => `Escribir al ${number} por WhatsApp (abre WhatsApp)`,
  },
  app: {
    navLabel: "App",
    navAria: "Obtener la app: ir a los enlaces de descarga",
    title: "Obtener la app",
    blurb: "Pida con un toque, guarde sus favoritos y siga su pedido.",
    iosTop: "Consíguelo en el",
    iosName: "App Store",
    androidTop: "Disponible en",
    androidName: "Google Play",
    storeAria: (badge) => `${badge} (se abre en una pestaña nueva)`,
    apk: "Descargar la app de Android (.apk)",
    apkHint: "Android le pedirá permiso para instalarla.",
  },
  hero: {
    welcomeAria: "Bienvenida",
    welcomeTo: "Bienvenidos a",
    tagline:
      "Recién hecho, servido al momento: explore la carta y pida directamente desde el móvil.",
    orderNow: "Pedir ahora ↓",
    features: [
      { title: "Servicio rápido", sub: "Directo de la cocina" },
      { title: "Máxima calidad", sub: "Ingredientes frescos" },
      { title: "Precios justos", sub: "Todos los días" },
    ],
    categoriesHeading: "Nuestras categorías",
    categoriesAria: "Categorías con foto",
    dishCount: (n) => (n === 1 ? "1 plato" : `${n} platos`),
  },
  metadata: {
    title: (venue) => `${venue} — Carta`,
    description: (venue) =>
      `Carta de ${venue}. Platos, precios, alérgenos e información dietética.`,
    srHeading: (venue) => `Carta de ${venue}`,
  },
};

/** Italian addresses the table, not one person — the plural "voi" form
 *  restaurants use with guests. */
const it: MenuCopy = {
  nav: {
    categories: "Categorie",
    dietaryFilter: "Filtro dietetico",
    language: "Lingua",
    all: "Tutto",
    allDiets: "Tutte le diete",
  },
  offers: {
    title: "Offerte",
    tab: "Offerte",
    count: (n) => (n === 1 ? "1 piatto in offerta" : `${n} piatti in offerta`),
  },
  badges: {
    open: "Aperto",
    until: (time) => `fino alle ${time}`,
    closed: "Chiuso",
    opensAt: (day, time) => `Apre ${day} alle ${time}`,
    unavailable: "non disponibile",
    offer: "Offerta",
    regularPrice: "prezzo normale",
    offerPrice: "prezzo in offerta",
    price: "prezzo",
    spicyTitle: (level) => `Piccante — livello ${level} di 3`,
    spicyLevel: (level) => `Piccante, livello ${level} di 3`,
  },
  rating: {
    write: "Scrivi una recensione",
    writeAria: "Scrivi una recensione su Google (si apre in una nuova scheda)",
    summary: (value, count) => `Valutato ${value} su 5 da ${count} recensioni Google`,
  },
  privacy: {
    title: "La tua privacy",
    body: "Questo menu non usa cookie di tracciamento. Il carrello e questa scelta restano solo sul tuo dispositivo.",
    link: "Informativa sulla privacy",
    ok: "Ho capito",
  },
  diets: {
    vegan: "Vegano",
    vegetarian: "Vegetariano",
    gluten_free: "Senza glutine",
    dairy_free: "Senza lattosio",
    halal: "Halal",
    kosher: "Kosher",
  },
  allergens: {
    info: "Informazioni sugli allergeni",
    infoFor: (dish) => `Informazioni sugli allergeni — ${dish}`,
    heading: "Allergeni",
    contains: "Contiene",
    traces: "Può contenere tracce di",
    close: "Chiudi",
  },
  dish: {
    more: "Altro",
    moreAbout: (dish) => `Altro su ${dish}`,
    close: "Chiudi",
  },
  /* Il pulsante Reclamo accanto a «Prenota un tavolo», e cosa dice quando
     questo browser non conosce alcun ordine. */
  complaint: {
    button: "Reclamo",
    title: "Inviare un reclamo",
    body: "Un reclamo è legato a un ordine. Apri il link di tracciamento nella conferma d'ordine, oppure effettua prima un ordine.",
    close: "Chiudi",
  },
  reserve: {
    buttonShort: "Prenota",
    buttonLong: "Prenota un tavolo",
    title: "Prenota un tavolo",
    holdNote: "Teniamo il vostro tavolo per 15 minuti oltre l'orario prenotato.",
    close: "Chiudi",
    received: "Richiesta ricevuta!",
    confirmByPhone: "Il ristorante confermerà la vostra prenotazione telefonicamente a breve.",
    done: "Fatto",
    date: "Data",
    time: "Orario",
    guests: "Persone",
    name: "Nome",
    phone: "Telefono",
    note: "Nota (facoltativa)",
    select: "Seleziona…",
    pickDateFirst: "Scegliete una data",
    guestCount: (n) => (n === 1 ? "1 persona" : `${n} persone`),
    notePlaceholder: "Compleanno, tavolo vicino alla finestra, passeggino…",
    sending: "Invio…",
    submit: "Richiedi prenotazione",
    noPayment: "Nessun pagamento richiesto: il ristorante conferma per telefono.",
    errorRateLimited: "Troppe richieste: riprovate tra un istante.",
    errorInvalidTime: "Quell'orario non è più disponibile: scegliete un altro slot.",
    errorGeneric: "Qualcosa è andato storto: riprovate o chiamateci.",
    requiredMark: "(obbligatorio)",
    requiredLegend: "* campo obbligatorio",
  },
  emptyStates: {
    noDishesInSection: "Nessun piatto in questa sezione.",
    noDietMatch:
      "Nessun piatto soddisfa tutte le diete scelte. Rimuovete un filtro qui sopra per vederne altri.",
    emptyMenu: "Il menu è ancora vuoto: il ristorante lo sta preparando.",
  },
  banners: {
    orderingPaused: "Gli ordini online sono sospesi in questo momento: riprovate tra poco.",
    draftPreview:
      "Anteprima della bozza: il vostro link privato. Gli ospiti vedono solo ciò che pubblicate.",
  },
  footer: {
    poweredBy: (brand) => `Servizio offerto da ${brand} · Menu digitali`,
    acceptedPayments: "Pagamenti accettati",
  },
  contact: {
    title: "Contatti",
    landline: "Chiama il fisso",
    mobile: "Chiama il cellulare",
    whatsapp: "WhatsApp",
    callAria: (label, number) => `${label}: ${number}`,
    whatsappAria: (number) => `Scrivi al ${number} su WhatsApp (apre WhatsApp)`,
  },
  app: {
    navLabel: "App",
    navAria: "Scarica l'app: vai ai link di download",
    title: "Scarica l'app",
    blurb: "Ordinate con un tocco, salvate i preferiti e seguite l'ordine.",
    iosTop: "Scaricala su",
    iosName: "App Store",
    androidTop: "Disponibile su",
    androidName: "Google Play",
    storeAria: (badge) => `${badge} (si apre in una nuova scheda)`,
    apk: "Scarica l'app Android (.apk)",
    apkHint: "Android vi chiederà di autorizzare l'installazione.",
  },
  hero: {
    welcomeAria: "Benvenuti",
    welcomeTo: "Benvenuti da",
    tagline:
      "Cucinato al momento, servito in fretta: sfogliate il menu e ordinate direttamente dal telefono.",
    orderNow: "Ordina ora ↓",
    features: [
      { title: "Servizio rapido", sub: "Direttamente dalla cucina" },
      { title: "Qualità migliore", sub: "Ingredienti freschi" },
      { title: "Prezzi onesti", sub: "Tutti i giorni" },
    ],
    categoriesHeading: "Le nostre categorie",
    categoriesAria: "Categorie con foto",
    dishCount: (n) => (n === 1 ? "1 piatto" : `${n} piatti`),
  },
  metadata: {
    title: (venue) => `${venue} — Menu`,
    description: (venue) =>
      `Menu di ${venue}. Piatti, prezzi, allergeni e informazioni dietetiche.`,
    srHeading: (venue) => `Menu di ${venue}`,
  },
};

/**
 * Modern Standard Arabic, addressing the guests in the plural — the
 * register an Arabic menu or a waiter would use. Counted nouns follow
 * MSA number agreement: 1 singular, 2 dual, 3–10 plural, 11+ singular
 * accusative.
 */
const ar: MenuCopy = {
  nav: {
    categories: "الأقسام",
    dietaryFilter: "تصفية حسب النظام الغذائي",
    language: "اللغة",
    all: "الكل",
    allDiets: "كل الأنظمة الغذائية",
  },
  offers: {
    title: "العروض",
    tab: "العروض",
    // MSA counted-noun agreement, same shape as `hero.dishCount`.
    count: (n) =>
      n === 1
        ? "طبق واحد في العرض"
        : n === 2
          ? "طبقان في العرض"
          : n <= 10
            ? `${n} أطباق في العرض`
            : `${n} طبقاً في العرض`,
  },
  badges: {
    open: "مفتوح",
    until: (time) => `حتى ${time}`,
    closed: "مغلق",
    opensAt: (day, time) => `يفتح ${day} ${time}`,
    unavailable: "غير متاح",
    offer: "عرض",
    regularPrice: "السعر العادي",
    offerPrice: "سعر العرض",
    price: "السعر",
    spicyTitle: (level) => `حار — المستوى ${level} من 3`,
    spicyLevel: (level) => `حار، المستوى ${level} من 3`,
  },
  rating: {
    write: "اكتب تقييماً",
    writeAria: "اكتب تقييماً على Google (يفتح في علامة تبويب جديدة)",
    summary: (value, count) => `التقييم ${value} من 5 بناءً على ${count} تقييماً على Google`,
  },
  privacy: {
    title: "خصوصيتك",
    body: "لا تستخدم هذه القائمة ملفات تعريف ارتباط للتتبع. تُحفظ سلتك وهذا الاختيار على جهازك فقط.",
    link: "سياسة الخصوصية",
    ok: "حسناً",
  },
  diets: {
    vegan: "نباتي صرف",
    vegetarian: "نباتي",
    gluten_free: "خالٍ من الغلوتين",
    dairy_free: "خالٍ من الألبان",
    halal: "حلال",
    kosher: "كوشر",
  },
  allergens: {
    info: "معلومات مسبّبات الحساسية",
    infoFor: (dish) => `معلومات مسبّبات الحساسية — ${dish}`,
    heading: "مسبّبات الحساسية",
    contains: "يحتوي على",
    traces: "قد يحتوي على آثار من",
    close: "إغلاق",
  },
  dish: {
    more: "المزيد",
    moreAbout: (dish) => `المزيد عن ${dish}`,
    close: "إغلاق",
  },
  /* زر الشكوى بجوار «احجز طاولة»، وما يقوله عندما لا يعرف هذا المتصفّح أي
     طلب. */
  complaint: {
    button: "شكوى",
    title: "تقديم شكوى",
    body: "ترتبط الشكوى بطلب. افتح رابط التتبّع في تأكيد طلبك، أو قدّم طلبًا أولًا.",
    close: "إغلاق",
  },
  reserve: {
    buttonShort: "احجز",
    buttonLong: "احجز طاولة",
    title: "حجز طاولة",
    holdNote: "نحتفظ بطاولتكم لمدة 15 دقيقة بعد الموعد المحجوز.",
    close: "إغلاق",
    received: "تم استلام طلبكم!",
    confirmByPhone: "سيؤكد المطعم حجزكم هاتفياً بعد قليل.",
    done: "تم",
    date: "التاريخ",
    time: "الوقت",
    guests: "عدد الضيوف",
    name: "الاسم",
    phone: "رقم الهاتف",
    note: "ملاحظة (اختياري)",
    select: "اختر…",
    pickDateFirst: "اختر التاريخ أولاً",
    guestCount: (n) =>
      n === 1 ? "ضيف واحد" : n === 2 ? "ضيفان" : n <= 10 ? `${n} ضيوف` : `${n} ضيفاً`,
    notePlaceholder: "عيد ميلاد، طاولة بجانب النافذة، عربة أطفال…",
    sending: "جارٍ الإرسال…",
    submit: "طلب الحجز",
    noPayment: "لا حاجة للدفع — يؤكد المطعم الحجز هاتفياً.",
    errorRateLimited: "طلبات كثيرة — يرجى المحاولة بعد قليل.",
    errorInvalidTime: "لم يعد هذا الموعد متاحاً — يرجى اختيار موعد آخر.",
    errorGeneric: "حدث خطأ ما — يرجى المحاولة مجدداً أو الاتصال بنا.",
    requiredMark: "(حقل مطلوب)",
    requiredLegend: "* حقل مطلوب",
  },
  emptyStates: {
    noDishesInSection: "لا توجد أطباق في هذا القسم.",
    noDietMatch:
      "لا توجد أطباق تطابق جميع الأنظمة الغذائية التي اخترتموها. أزيلوا أحد عوامل التصفية بالأعلى لعرض المزيد.",
    emptyMenu: "لا توجد أطباق بعد — المطعم لا يزال يُعدّ القائمة.",
  },
  banners: {
    orderingPaused: "الطلب عبر الإنترنت متوقف مؤقتاً — يرجى العودة قريباً.",
    draftPreview: "معاينة المسودة — رابطكم الخاص. لا يرى الضيوف سوى ما تنشرونه.",
  },
  footer: {
    poweredBy: (brand) => `مُقدَّم من ${brand} · قوائم طعام رقمية`,
    acceptedPayments: "طرق الدفع المقبولة",
  },
  contact: {
    title: "تواصلوا معنا",
    landline: "اتصال بالهاتف الأرضي",
    mobile: "اتصال بالجوال",
    whatsapp: "واتساب",
    callAria: (label, number) => `${label}: ${number}`,
    whatsappAria: (number) => `مراسلة ${number} عبر واتساب (يفتح واتساب)`,
  },
  app: {
    navLabel: "التطبيق",
    navAria: "احصل على التطبيق — انتقل إلى روابط التنزيل",
    title: "احصل على التطبيق",
    blurb: "اطلبوا بلمسة واحدة، واحفظوا المفضّلة، وتابعوا طلبكم.",
    iosTop: "نزّله من",
    iosName: "App Store",
    androidTop: "احصل عليه من",
    androidName: "Google Play",
    storeAria: (badge) => `${badge} (يفتح في تبويب جديد)`,
    apk: "تنزيل تطبيق أندرويد (.apk)",
    apkHint: "سيطلب منكم أندرويد السماح بالتثبيت.",
  },
  hero: {
    welcomeAria: "ترحيب",
    welcomeTo: "أهلاً بكم في",
    tagline: "طهي طازج وتقديم سريع — تصفّحوا القائمة واطلبوا مباشرةً من هواتفكم.",
    orderNow: "اطلب الآن ↓",
    features: [
      { title: "تقديم سريع", sub: "مباشرةً من المطبخ" },
      { title: "أفضل جودة", sub: "مكوّنات طازجة" },
      { title: "أسعار عادلة", sub: "كل يوم" },
    ],
    categoriesHeading: "أقسامنا",
    categoriesAria: "الأقسام بالصور",
    dishCount: (n) =>
      n === 1 ? "طبق واحد" : n === 2 ? "طبقان" : n <= 10 ? `${n} أطباق` : `${n} طبقاً`,
  },
  metadata: {
    title: (venue) => `${venue} — قائمة الطعام`,
    description: (venue) =>
      `قائمة طعام ${venue}. الأطباق والأسعار ومعلومات مسبّبات الحساسية والأنظمة الغذائية.`,
    srHeading: (venue) => `قائمة طعام ${venue}`,
  },
};

export const MENU_COPY: Record<UiLocale, MenuCopy> = { de, en, fr, es, it, ar };

/**
 * Catalogue for a venue/route locale. Region tags collapse ("en-GB" →
 * "en") and anything without a catalogue falls back to English, so a
 * caller never has to validate the locale first.
 */
export function menuCopy(locale: string | null | undefined): MenuCopy {
  return MENU_COPY[uiLocale(locale)];
}
