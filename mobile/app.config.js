/**
 * Dynamic Expo config: `app.json` holds the venue-independent shape
 * (orientation, plugins, tablet support), and this file merges the
 * venue-derived half over it from `brand.generated.json`.
 *
 * Regenerate with `pnpm brand:mobile --venue <slug>` in the repo root — never
 * hand-edit brand.generated.json. Everything brand-shaped (name, slug,
 * scheme, store ids, icons, splash, colors) comes from that file, so pointing
 * the app at a different restaurant is one command plus a rebuild.
 *
 * Expo passes the static config in as `config`; see
 * https://docs.expo.dev/versions/v57.0.0/config/app/ and
 * https://docs.expo.dev/workflow/configuration/.
 */
let brand;
try {
  brand = require("./brand.generated.json");
} catch {
  throw new Error(
    "mobile/brand.generated.json is missing — run `pnpm brand:mobile --venue <slug>` in the repo root first.",
  );
}

/**
 * Google's iOS SDK needs the "reversed client id" registered as a URL
 * scheme. Accepts either form of EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:
 * `123-abc.apps.googleusercontent.com` or the already-reversed
 * `com.googleusercontent.apps.123-abc`. Returns null when the var is
 * unset or unrecognisable, so the config still evaluates in a checkout
 * that has no Google credentials (the app falls back to the browser
 * sign-in flow — see src/auth.tsx).
 */
function iosUrlScheme(clientId) {
  if (!clientId) return null;
  const id = String(clientId).trim();
  if (id.startsWith("com.googleusercontent.apps.")) return id;
  const suffix = ".apps.googleusercontent.com";
  if (!id.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${id.slice(0, -suffix.length)}`;
}

/**
 * Apple Pay's merchant id, read at CONFIG time from the environment
 * (`APPLE_MERCHANT_ID=merchant.com.elvoria.ranglapunjab`). It is ⛔
 * human-gated: creating the merchant id and uploading the Stripe
 * payment-processing certificate is an Apple Developer account job.
 *
 * Unset — the default, and what every build in this repo does today —
 * means: no `com.apple.developer.in-app-payments` entitlement is written,
 * `initPaymentSheet` is NOT given an `applePay` block, and the app's
 * platform-pay button never renders on iOS. Setting it is the only thing
 * that turns any of that on (plus a native rebuild: the entitlement is
 * part of the binary).
 */
const appleMerchantId = (process.env.APPLE_MERCHANT_ID ?? "").trim() || null;

module.exports = ({ config }) => {
  const generated = brand.expo ?? {};
  const android = { ...config.android, ...generated.android };
  // The generated adaptive icon replaces the static one wholesale — mixing a
  // generated foreground with a stale monochrome layer would ship two
  // different logos in one icon.
  if (generated.android?.adaptiveIcon) android.adaptiveIcon = generated.android.adaptiveIcon;

  const plugins = [
    ...(config.plugins ?? []),
    "expo-localization",
    "expo-secure-store",
    "expo-web-browser",
    // Native Stripe PaymentSheet. Unconditional: the publishable key is NOT
    // baked into the build, it arrives from the server per order, so there is
    // no credential to gate this on. `enableGooglePay` writes the
    // `com.google.android.gms.wallet.api.enabled` manifest flag Google Pay
    // needs.
    //
    // Apple Pay rides on APPLE_MERCHANT_ID (⛔ above): with it, the
    // plugin writes the `com.apple.developer.in-app-payments`
    // entitlement and `src/payments.ts` turns the sheet's Apple Pay row
    // and the platform-pay button on. Without it — the default — the
    // plugin options are exactly what they were before P7-13.
    [
      "@stripe/stripe-react-native",
      {
        enableGooglePay: true,
        ...(appleMerchantId ? { merchantIdentifier: appleMerchantId } : {}),
      },
    ],
  ];
  // Native one-tap Google sign-in is opt-in per build: without the iOS
  // client id there is no URL scheme to register, and the plugin throws
  // rather than shipping a half-configured sheet.
  const scheme = iosUrlScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
  if (scheme) {
    plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme: scheme }]);
  }

  return {
    ...config,
    ...generated,
    ios: { ...config.ios, ...generated.ios },
    android,
    web: { ...config.web, ...generated.web },
    plugins,
    // The Apple Pay keys go on LAST so a regenerated brand file can never
    // clobber them; the runtime reads both through `expo-constants`
    // (`src/payments.ts`). `applePayEnabled` is the one flag every UI
    // gate checks, `appleMerchantId` is what `initStripe` needs.
    extra: {
      ...config.extra,
      ...generated.extra,
      applePayEnabled: Boolean(appleMerchantId),
      ...(appleMerchantId ? { appleMerchantId } : {}),
    },
  };
};
