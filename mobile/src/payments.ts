import type React from "react";
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { PaymentIntentInfo } from "./api";
import {
  confirmFakePayment,
  createPaymentIntent,
  fetchWalletConfig,
  payPageUrl,
  startPaypal,
} from "./api";
import { openReturningPage } from "./browser";
import type { PlatformPayButtonProps } from "./stripe-module";
import { loadStripe } from "./stripe-module";

/**
 * Paying from inside the app.
 *
 * Two routes, in preference order:
 *
 *  1. **Native PaymentSheet** (`payWithCard`) — Stripe's own bottom sheet,
 *     with saved cards and, when the restaurant ticked them, the wallet
 *     rows (`opts.wallets`). `@stripe/stripe-react-native` is a
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

/** The merchant country for both wallets. The venue is a German GmbH and
 *  the Stripe account is German; this is the account's country, not the
 *  guest's. */
const MERCHANT_COUNTRY = "DE";

/**
 * Apple Pay's merchant id, or null when this build has none (P7-13).
 *
 * ⛔ Human-gated: `app.config.js` reads `APPLE_MERCHANT_ID` at config time
 * and only then writes the `merchantIdentifier` plugin option (which
 * writes the entitlement) and these two `extra` keys. Null is the default
 * and means: no `applePay` block for the payment sheet, no Apple Pay row
 * inside it, and no platform-pay button on iOS. Nothing else changes.
 */
export function appleMerchantId(): string | null {
  const extra = Constants.expoConfig?.extra;
  if (!extra || extra.applePayEnabled !== true) return null;
  const id = extra.appleMerchantId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Which wallets the RESTAURANT ticked in Settings → "Payment methods you
 * accept". Everything wallet-shaped in here takes this as an AND on top
 * of the device/entitlement gates: a venue that does not take Apple Pay
 * must not be shown an Apple Pay button, however capable the phone is.
 */
export interface WalletChoice {
  applePay: boolean;
  googlePay: boolean;
}

/**
 * Map the venue's `acceptedPayments` ids onto the two wallets.
 *
 * Absent (an older server, a menu that has not loaded yet) reads as
 * "neither": the safe answer is no wallet button rather than one the
 * restaurant never asked for.
 */
export function walletsFromAccepted(accepted: readonly string[] | undefined): WalletChoice {
  return {
    applePay: accepted?.includes("apple_pay") ?? false,
    googlePay: accepted?.includes("google_pay") ?? false,
  };
}

/**
 * The publishable key the Stripe SDK was last initialised with, or null
 * when it never has been in this process.
 *
 * Module-level because `PaymentConfiguration` on Android is a process-wide
 * singleton: initialising twice with the same key is wasted work, and the
 * cart remounts on every tab switch. Re-initialising when the key CHANGES
 * is still required — a venue can be flipped from test to live keys
 * without a new binary.
 */
let initialisedKey: string | null = null;

/**
 * `initStripe`, at most once per key.
 *
 * Every path that can construct a native Stripe launcher must go through
 * here first — see the crash note on `isPlatformPayAvailable`.
 */
async function ensureStripeInit(publishableKey: string, merchantId: string | null): Promise<void> {
  const stripe = loadStripe();
  if (!stripe) return;
  if (initialisedKey === publishableKey) return;
  await stripe.initStripe({
    publishableKey,
    urlScheme: APP_SCHEME,
    // Only when the merchant id exists (⛔): without the entitlement an
    // Apple Pay row in the sheet would dead-end.
    ...(merchantId ? { merchantIdentifier: merchantId } : {}),
  });
  initialisedKey = publishableKey;
}

/**
 * Is there a native wallet button to draw at all?
 *
 * Every "no" here is a legitimate, silent state, not an error:
 *  - the restaurant did not tick this platform's wallet in its settings;
 *  - web / Expo Go — no native module;
 *  - iOS without `APPLE_MERCHANT_ID` — the entitlement isn't in the
 *    binary, so an Apple Pay button would open a sheet that fails;
 *  - the venue has no real Stripe account (fake provider, no keys), so
 *    there would be nothing for a wallet to confirm;
 *  - a device with no wallet configured.
 *
 * ⚠ CRASH CLASS — do not remove the `ensureStripeInit` below.
 *
 * On Android, `isPlatformPaySupported()` constructs a
 * `GooglePayPaymentMethodLauncher`, whose constructor calls
 * `PaymentConfiguration.getInstance()`. If `initStripe` has never run in
 * this process that throws `IllegalStateException("PaymentConfiguration
 * was not initialized…")` on the main thread — a hard process crash, not
 * a rejected promise, so the `try/catch` around the call cannot save it.
 * (`StripeSdkModule.isPlatformPaySupported` has no `::stripe.isInitialized`
 * guard, unlike `confirmPlatformPay`.) The cart probes this on mount, and
 * a guest who has not paid by card yet has never initialised the SDK — so
 * every Android guest who opened the cart on a build with Google Pay
 * ticked crashed. The key therefore comes from `/api/v1/pay/wallet-config`
 * BEFORE the probe, and no key at all means no probe at all.
 *
 * iOS needs none of this: its probe only asks the device whether Apple Pay
 * is set up, and does not touch `PaymentConfiguration`.
 */
export async function isPlatformPayAvailable(wallets: WalletChoice): Promise<boolean> {
  const stripe = loadStripe();
  if (!stripe) return false;
  if (Platform.OS === "ios" && (!appleMerchantId() || !wallets.applePay)) return false;
  if (Platform.OS === "android" && !wallets.googlePay) return false;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  try {
    if (Platform.OS === "android") {
      const config = await fetchWalletConfig();
      // No real Stripe account: no button, and — crucially — no probe.
      if (!config.publishableKey) return false;
      await ensureStripeInit(config.publishableKey, appleMerchantId());
      return await stripe.isPlatformPaySupported({
        googlePay: {
          // A test key means Google's test environment, which is also all
          // a not-yet-approved app may use. Same rule as the sheet.
          testEnv: config.publishableKey.startsWith("pk_test_"),
        },
      });
    }
    return await stripe.isPlatformPaySupported();
  } catch {
    return false;
  }
}

/** Stripe's own Apple Pay / Google Pay button, or null when this build
 *  has no Stripe module. Reached through the seam so the web bundle still
 *  contains no Stripe import. */
export function platformPayButton(): React.ComponentType<PlatformPayButtonProps> | null {
  return loadStripe()?.PlatformPayButton ?? null;
}

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
  opts: { merchantDisplayName: string; wallets: WalletChoice },
): Promise<CardOutcome> {
  const created = await createPaymentIntent(orderId, token);
  if (!created.ok) {
    // The order is already settled — nothing to pay, and the Track screen
    // will read "paid" on its next poll.
    if (created.error === "already_paid") return "paid";
    if (FALL_BACK_TO_HOSTED.has(created.error)) return "unavailable";
    return "failed";
  }
  return payIntentWithCard(created.intent, opts);
}

/**
 * The payment sheet, against an intent SOMEONE ELSE created.
 *
 * Split out of `payWithCard` for gift cards: buying one mints its
 * PaymentIntent in the same call that mints the card
 * (`POST /api/v1/gift-cards` answers with both), so there is no second
 * "create an intent" round trip to make — but the sheet, the wallet
 * rows, the test-provider escape hatch and the `CardOutcome` union
 * should be letter-for-letter the ones the cart already handles.
 */
export async function payIntentWithCard(
  intent: PaymentIntentInfo,
  opts: { merchantDisplayName: string; wallets: WalletChoice },
): Promise<CardOutcome> {
  // Dev/CI provider: there is no sheet to present. The caller shows the
  // test button and settles through `confirmFakePayment`.
  if (intent.mode === "fake") return { fake: { ref: intent.ref } };

  const stripe = loadStripe();
  if (!stripe || !intent.publishableKey) return "unavailable";

  const merchantId = appleMerchantId();
  try {
    await ensureStripeInit(intent.publishableKey, merchantId);
    const init = await stripe.initPaymentSheet({
      paymentIntentClientSecret: intent.clientSecret,
      merchantDisplayName: opts.merchantDisplayName || intent.merchantName,
      returnURL: STRIPE_RETURN_URL,
      // A wallet row appears inside the sheet only when the restaurant
      // ticked that wallet (and, for Apple, the entitlement is in the
      // binary). Omitting the block is what removes the row.
      ...(merchantId && opts.wallets.applePay
        ? { applePay: { merchantCountryCode: MERCHANT_COUNTRY } }
        : {}),
      ...(opts.wallets.googlePay
        ? {
            googlePay: {
              merchantCountryCode: MERCHANT_COUNTRY,
              currencyCode: intent.currency.toUpperCase(),
              // Google Pay stays in its test environment until the Google
              // Pay & Wallet Console approves the production app — which
              // is exactly when the venue's key stops being a test key.
              testEnv: intent.publishableKey.startsWith("pk_test_"),
            },
          }
        : {}),
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

/**
 * Pay with Apple Pay / Google Pay directly — no payment sheet in between
 * (P7-13).
 *
 * Same contract as `payWithCard`, and deliberately the same `CardOutcome`
 * union, so the cart's placing state machine has exactly one set of
 * branches to handle whichever button was pressed.
 *
 * The wallet is only ever opened against a REAL Stripe PaymentIntent: a
 * `fake` intent (the dev/CI provider) returns the same `{ fake }` outcome
 * the card route does and the cart shows its labelled test button, and a
 * venue with no publishable key falls back to the hosted page. There is no
 * path on which a native wallet sheet is shown for something Stripe is
 * not actually charging.
 */
export async function payWithPlatformPay(
  orderId: string,
  token: string,
  opts: { merchantDisplayName: string; wallets: WalletChoice },
): Promise<CardOutcome> {
  const created = await createPaymentIntent(orderId, token);
  if (!created.ok) {
    if (created.error === "already_paid") return "paid";
    if (FALL_BACK_TO_HOSTED.has(created.error)) return "unavailable";
    return "failed";
  }
  const intent = created.intent;
  if (intent.mode === "fake") return { fake: { ref: intent.ref } };

  const stripe = loadStripe();
  if (!stripe || !intent.publishableKey) return "unavailable";
  const merchantId = appleMerchantId();
  // The restaurant's tick is a hard gate, exactly like the entitlement:
  // "unavailable" sends the caller to the hosted page instead.
  if (Platform.OS === "ios" && (!merchantId || !opts.wallets.applePay)) return "unavailable";
  if (Platform.OS === "android" && !opts.wallets.googlePay) return "unavailable";

  const name = opts.merchantDisplayName || intent.merchantName;
  const currency = intent.currency.toUpperCase();
  try {
    await ensureStripeInit(intent.publishableKey, merchantId);
    // Only the blocks the owner allows are sent; each platform ignores
    // the other's anyway, so the gate above already decided the outcome.
    const result = await stripe.confirmPlatformPayPayment(intent.clientSecret, {
      ...(opts.wallets.applePay
        ? {
            applePay: {
              merchantCountryCode: MERCHANT_COUNTRY,
              currencyCode: currency,
              // Apple's sheet shows the last line as "Pay <name>
              // <amount>", so the single line IS the total.
              cartItems: [
                {
                  paymentType: "Immediate" as const,
                  label: name,
                  amount: (intent.amountCents / 100).toFixed(2),
                },
              ],
            },
          }
        : {}),
      ...(opts.wallets.googlePay
        ? {
            googlePay: {
              merchantCountryCode: MERCHANT_COUNTRY,
              currencyCode: currency,
              merchantName: name,
              // Same rule as the sheet: a test key means Google's test
              // environment, which is also all a not-yet-approved app
              // may use.
              testEnv: intent.publishableKey.startsWith("pk_test_"),
            },
          }
        : {}),
    });
    if (!result.error) return "paid";
    const code = result.error.code;
    return code === "Canceled" || code === "Cancelled" ? "cancelled" : "failed";
  } catch {
    return "failed";
  }
}

/** Settle a fake intent. Re-exported here so screens have one payments
 *  import rather than two. */
export { confirmFakePayment };

/**
 * Open a payment page WITHOUT leaving the app — "approve in PayPal, land
 * back on the order" as one flow. The mechanics live in `browser.ts`
 * because the browser sign-in in `auth.tsx` needs the identical
 * open-and-come-back behaviour.
 */
export async function openPayPage(url: string, returnUrl: string): Promise<void> {
  await openReturningPage(url, returnUrl);
}

/**
 * Pay with PayPal, in one tap.
 *
 * The server starts the payment and hands back PayPal's own approve URL,
 * so the browser opens ON PayPal rather than on our pay page with a
 * "Pay with PayPal" button the guest has to press first. The return leg
 * sees the deep link and bounces the browser straight back here, so
 * there is no "Back to the app" tap at the other end either.
 *
 * If the start call fails (offline, old server, PayPal switched off) we
 * fall back to the web pay page, which handles all of those with its own
 * copy — and still returns on the same deep link.
 */
export async function payWithPaypal(
  orderId: string,
  token: string,
  /** The guest's app language, so the fallback pay page is rendered in
   *  it rather than in the venue's default. */
  locale?: string,
): Promise<void> {
  const deepLink = ExpoLinking.createURL("payment-return");
  const started = await startPaypal(orderId, token, deepLink);
  await openReturningPage(
    started.ok ? started.url : payPageUrl(orderId, token, deepLink, locale),
    deepLink,
  );
}

/** True between "present the in-app browser" and "it is gone again".
 *  Module-level on purpose: two different screens may race to open one,
 *  and iOS answers a second present-while-presenting with a stale layer
 *  that eats every touch. */
let browserOpen = false;

/**
 * The receipt PDF, the dashboard, and anything else that is read rather
 * than transacted.
 *
 * Callers that open this from inside a `<Modal>` must wait for the modal
 * to finish dismissing first (see `owner-menu.tsx`) — presenting on top
 * of a dismissing view controller is the other half of the same iOS bug.
 */
export async function openInAppBrowser(url: string): Promise<void> {
  if (Platform.OS === "web") {
    await Linking.openURL(url);
    return;
  }
  if (browserOpen) return;
  browserOpen = true;
  try {
    await WebBrowser.openBrowserAsync(url, {
      // An explicit ✕ rather than "Done": this is a page to read and
      // leave, not a flow that finishes.
      dismissButtonStyle: "close",
      // The default `overFullScreen` keeps our view visible underneath,
      // which is exactly the layering that traps touches when the sheet
      // below is still animating away.
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    });
  } catch {
    await Linking.openURL(url).catch(() => {});
  } finally {
    browserOpen = false;
  }
}
