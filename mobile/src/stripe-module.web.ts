/**
 * Web build of `stripe-module.ts`: there is no native PaymentSheet in a
 * browser, so this deliberately imports nothing from the Stripe package —
 * Metro would otherwise follow the import into native-only specs and fail
 * the web export. The app pays through the hosted page on web.
 */
export function loadStripe(): null {
  return null;
}
