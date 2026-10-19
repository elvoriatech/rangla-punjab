/**
 * "Don't close this window" on Stripe's hosted payment page (owner,
 * 2026-10-19). Stripe shows `custom_text.submit.message` next to its Pay
 * button; the guest otherwise has no sign that closing the tab before the
 * page sends them back can leave the order unpaid and off the kitchen's
 * screen. Keyed by the language the guest ordered in; anything unknown
 * falls back to German, the venue's own language.
 */
const MESSAGES: Record<string, string> = {
  de: "Bitte schließen Sie dieses Fenster nicht, bis die Zahlung abgeschlossen ist und Sie zur Bestellbestätigung zurückgeleitet werden.",
  en: "Please don't close this window until the payment is complete and you are taken back to your order confirmation.",
  fr: "Veuillez ne pas fermer cette fenêtre avant la fin du paiement et le retour à la confirmation de votre commande.",
  it: "Non chiudere questa finestra finché il pagamento non è completato e non torni alla conferma dell'ordine.",
  es: "No cierres esta ventana hasta que el pago se complete y vuelvas a la confirmación de tu pedido.",
  ar: "يُرجى عدم إغلاق هذه النافذة حتى يكتمل الدفع وتعود إلى تأكيد طلبك.",
};

/** Stripe Checkout's own UI languages that match ours; Arabic is not one. */
const STRIPE_LOCALES = new Set(["de", "en", "fr", "it", "es"]);

export function paymentWaitMessage(locale: string | null | undefined): string {
  return MESSAGES[locale ?? ""] ?? MESSAGES.de!;
}

/** The `locale` to hand Stripe Checkout: the guest's language, or "auto". */
export function stripeCheckoutLocale(
  locale: string | null | undefined,
): "de" | "en" | "fr" | "it" | "es" | "auto" {
  return locale && STRIPE_LOCALES.has(locale)
    ? (locale as "de" | "en" | "fr" | "it" | "es")
    : "auto";
}
