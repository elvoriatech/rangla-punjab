/** Guest checkout copy — French (Français). Loaded on its own chunk by
 *  `./load.ts`; `en.ts` supplies the shape (type-only import, so no
 *  English strings ride along). */
import type { CheckoutCopy } from "./en";

const fr: CheckoutCopy = {
  yourOrder: "Votre commande",
  placedBadge: (n) => `Commande n° ${n} ✓`,
  headingPlaced: (n) => `Commande n° ${n}`,
  close: "Fermer le panneau de commande",

  each: (price) => `${price} l'unité`,
  oneLess: (name) => `Réduire la quantité de ${name}`,
  oneMore: (name) => `Augmenter la quantité de ${name}`,
  removeLine: (name) => `Retirer ${name} de la commande`,
  remove: "Retirer",
  total: "Total",
  vatIncluded: (rate, amount) => `TVA ${rate} % incluse ${amount}`,
  loyaltyEarn: (points) => `Vous cumulerez ${points} points avec cette commande`,
  loyaltySignIn: (points) => `Connectez-vous pour cumuler ${points} points sur cette commande`,
  clearCart: "Vider la commande",
  addItems: "Ajouter des plats",

  orderTypeGroup: "Type de commande",
  dineIn: "Sur place",
  takeaway: "À emporter",
  delivery: "Livraison",

  tableNumber: "Numéro de table (facultatif)",
  tableNumberPlaceholder: "p. ex. 12",
  yourName: "Votre nom",
  phone: "Numéro de téléphone",
  phonePlaceholder: "+33 …",
  deliveryTime: "Heure de livraison",
  pickupTime: "Heure de retrait",
  asap: "Dès que possible",
  email: "E-mail (facultatif) — nous vous envoyons votre reçu",
  emailPlaceholder: "vous@exemple.com",
  street: "Rue et numéro",
  zip: "Code postal",
  selectPlaceholder: "Choisir…",
  city: "Ville / Commune / Village",
  cityPlaceholder: "— choisissez votre code postal —",
  deliveryNote: "Remarque pour la livraison (facultatif)",
  deliveryNotePlaceholder: "p. ex. sonner deux fois, 3e étage",

  addressTitle: "Adresse de livraison",
  addressChange: "Modifier",

  timeNow: "Maintenant",
  timeScheduled: "Programmée",
  closedPreorderNote:
    "Nous sommes fermés pour le moment — vous pouvez commander à l'avance pour plus tard dans la journée.",
  closedDineIn: "La commande à table n'est possible que pendant les heures d'ouverture.",
  timeEarlier: "Plus tôt",
  timeLater: "Plus tard",

  freeDeliveryHere: "Livraison gratuite dans ce secteur 🎉",
  freeDeliveryFrom: (amount) => `Livraison gratuite à partir de ${amount}`,
  deliveryFee: (fee) => `Frais de livraison ${fee}`,
  minimumOrderSuffix: (min) => ` · commande minimum ${min}`,
  minimumOrder: (min) => `Commande minimum ${min}`,
  belowMinimum: (min, missing) => `Livraison à partir de ${min} — il manque encore ${missing}.`,

  payGroup: "Commander et payer",
  paymentMethod: "Paiement",
  payOrChoose: "ou choisir un autre moyen de paiement",
  pay: "Payer",
  placeOrder: "Commander",
  card: "Carte bancaire",
  paypal: "PayPal",
  payAtTable: "Payer à table",
  payAtPickup: "Payer au retrait",
  cashToDriver: "Espèces au livreur",
  placing: "Envoi en cours…",
  opening: "Ouverture…",
  explainerOnline: "Paiement sécurisé",
  explainerDelivery: "Aucun paiement en ligne — vous payez le livreur.",
  explainerPickup: "Aucun paiement en ligne — vous payez au retrait.",
  explainerDineIn: "Aucun paiement maintenant — vous payez au restaurant.",
  securedBy: (providers) => `Paiement sécurisé via ${providers}`,

  placedIntro: "Votre commande est bien arrivée — l'équipe la voit comme la",
  placedRef: (n) => `commande n° ${n}`,
  placedForTable: (table) => ` pour la table ${table}`,
  placedCashTail: ", à régler au restaurant. Votre reçu est en cours de téléchargement.",
  placedEmailTail: (email, pending) =>
    ` Nous enverrons votre reçu à ${email}${pending ? " dès que le paiement sera confirmé" : ""}.`,
  payOnline: (amount) => `Payer en ligne · ${amount}`,
  openingPayment: "Ouverture du paiement…",
  openingPaypal: "Ouverture de PayPal…",
  payWithPaypal: "Payer avec PayPal",
  trackOrder: "Suivre votre commande",
  downloadReceipt: "Télécharger le reçu (PDF)",
  startNewOrder: "Passer une nouvelle commande",

  errPaypalOpen:
    "PayPal n'a pas pu être ouvert — votre commande est enregistrée ; réessayez avec le bouton PayPal ci-dessous ou payez au restaurant.",
  errCardOpen:
    "Le paiement par carte n'a pas pu être ouvert — votre commande est enregistrée ; réessayez avec le bouton ci-dessous ou payez au restaurant.",
  errPayRetry:
    "Aucune connexion — votre commande est enregistrée ; réessayez le paiement ci-dessous.",
  errWalletPay:
    "Le paiement par portefeuille n'a pas abouti — votre commande est enregistrée ; choisissez un autre moyen de paiement ci-dessous.",
  errUnknownItems:
    "La carte a changé pendant votre commande. Merci de vérifier vos plats et de réessayer.",
  errRateLimited: "Trop de commandes depuis cette connexion — merci de patienter une minute.",
  errTypeNotAvailable: "Ce type de commande vient d'être désactivé — merci d'en choisir un autre.",
  errOutsideArea: "Cette adresse se situe malheureusement hors de la zone de livraison.",
  errBelowMinimum: (min) => `Livraison à partir de ${min} — ajoutez encore un peu.`,
  errInvalidTime:
    "Cet horaire vient de passer ou se situe hors des heures d'ouverture — merci d'en choisir un autre.",
  errVenueClosed:
    "Nous venons de fermer — choisissez un horaire plus tard dans la journée ou revenez demain.",
  errGeneric: "La commande n'a pas abouti. Merci de réessayer.",
  errNoConnection: "Aucune connexion — vérifiez votre réseau et réessayez.",

  add: "+ Ajouter",
  added: "Ajouté ✓",
  addAria: (name) => `Ajouter ${name} à la commande`,

  requiredMark: "(obligatoire)",
  requiredLegend: "* champ obligatoire",
};

export default fr;
