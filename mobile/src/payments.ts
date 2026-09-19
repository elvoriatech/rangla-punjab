import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { confirmFakePayment, createPaymentIntent } from "./api";
import { loadStripe } from "./stripe-module";

/**
 * Paying from inside the app.
 *
 * Two routes, in preference order:
 *
 *  1. **Native PaymentSheet** (`payWithCard`) — Stripe's own bottom sheet,
 *     with Google Pay and saved cards. `@stripe/stripe-react-native` is a
 *     NATIVE module: it does not exist in Expo Go or on web, so it is
 *     reached through `stripe-module.ts` / `stripe-module.web.ts`, which
 *     hand back null instead of throwing (same posture as the Google SDK
 *     in `auth.tsx`).
 *  2. **Hosted page in an in-app browser** (`openPayPage`) — Stripe
 *     Checkout or our own /pay page, opened in Custom Tabs /
 *     SFSafariViewController. This is where PayPal lives, and it is the
 *     fallback whenever (1) is unavailable.
 *
 * The publishable key is NOT baked into the build: it rides the server's
 * intent response, so flipping the venue from Stripe test keys to live
 * keys needs no new app binary.
 */

/** The build's own URL scheme (`ranglapunjab://`). Stripe needs it twice:
 *  as `urlScheme` so the SDK can register its redirect handler, and as the
 *  `returnURL` a 3-D Secure page bounces back to. `app.config.js` takes it
 *  from `brand.generated.json`; the literal fallback keeps the flow working
 *  if the config ever fails to reach the runtime. */
export const APP_SCHEME: string =
  (typeof Constants.expoConfig?.scheme === "string" ? Constants.expoConfig.scheme : null) ??
  "ranglapunjab";

/** Where a 3-D Secure challenge returns to. Must match the `urlScheme`
 *  passed to `initStripe` — Stripe dismisses its own web view on it. */
export const STRIPE_RETURN_URL = `${APP_SCHEME}://stripe-redirect`;

/**
 * What a card attempt ended as.
 *
 * `"unavailable"` is the only one the caller answers by falling back to
 * the hosted page; `{ fake: … }` means the dev provider is in play and the
 * UI must offer its clearly-labelled "Simulate payment (test)" button.
 */
export type CardOutcome =
  "paid" | "cancelled" | "failed" | "unavailable" | { fake: { ref: string } };

/** Server answers that mean "the native sheet cannot help here" — the
 *  caller should open the hosted page rather than show an error. */
const FALL_BACK_TO_HOSTED = new Set([
  "not_available",
  "publishable_key_missing",
  "network",
  "rate_limited",
  // A server that predates this endpoint (version skew during a deploy)
  // answers with its HTML 404 — the hosted checkout it does have still
  // takes the payment.
  "http_404",
]);

export async function payWithCard(
  orderId: string,
  token: string,
  opts: { merchantDisplayName: string },
): Promise<CardOutcome> {
  const created = await createPaymentIntent(orderId, token);
  if (!created.ok) {
    // The order is already settled — nothing to pay, and the Track screen
    // will read "paid" on its next poll.
    if (created.error === "already_paid") return "paid";
    if (FALL_BACK_TO_HOSTED.has(created.error)) return "unavailable";
    return "failed";
  }
  const intent = created.intent;

  // Dev/CI provider: there is no sheet to present. The caller shows the
  // test button and settles through `confirmFakePayment`.
  if (intent.mode === "fake") return { fake: { ref: intent.ref } };

  const stripe = loadStripe();
  if (!stripe || !intent.publishableKey) return "unavailable";

  try {
    await stripe.initStripe({
      publishableKey: intent.publishableKey,
      urlScheme: APP_SCHEME,
    });
    const init = await stripe.initPaymentSheet({
      paymentIntentClientSecret: intent.clientSecret,
      merchantDisplayName: opts.merchantDisplayName || intent.merchantName,
      returnURL: STRIPE_RETURN_URL,
      googlePay: {
        merchantCountryCode: "DE",
        currencyCode: intent.currency.toUpperCase(),
        // Google Pay stays in its test environment until the Google Pay &
        // Wallet Console approves the production app — which is exactly
        // when the venue's key stops being a test key.
        testEnv: intent.publishableKey.startsWith("pk_test_"),
      },
      // Every accepted method must settle at the counter, not days later:
      // the kitchen ships food against this payment.
      allowsDelayedPaymentMethods: false,
    });
    if (init.error) return "failed";
    const presented = await stripe.presentPaymentSheet();
    if (!presented.error) return "paid";
    return presented.error.code === "Canceled" ? "cancelled" : "failed";
  } catch {
    return "failed";
  }
}

/** Settle a fake intent. Re-exported here so screens have one payments
 *  import rather than two. */
export { confirmFakePayment };

/**
 * Open a payment page WITHOUT leaving the app: Custom Tabs on Android,
 * SFSafariViewController on iOS. `openAuthSessionAsync` closes the tab
 * itself the moment the page navigates to `returnUrl`, which is what makes
 * "approve in PayPal, land back on the order" feel like one flow.
 */
export async function openPayPage(url: string, returnUrl: string): Promise<void> {
  if (Platform.OS === "web") {
    await Linking.openURL(url);
    return;
  }
  try {
    await WebBrowser.openAuthSessionAsync(url, returnUrl);
  } catch {
    // No Custom Tabs provider / no SFSafariViewController: a plain in-app
    // browser still completes the payment, the guest just taps Done.
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      await Linking.openURL(url).catch(() => {});
    }
  }
}

/** The receipt PDF and anything else that is read, not transacted. */
export async function openInAppBrowser(url: string): Promise<void> {
  if (Platform.OS === "web") {
    await Linking.openURL(url);
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await Linking.openURL(url).catch(() => {});
  }
}
