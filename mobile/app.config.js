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

/**
 * The public site's host, for the driver-dispatch deep links.
 *
 * Taken from `EXPO_PUBLIC_API_URL` — the same variable `src/api.ts`
 * builds every request against, so the app can only ever claim links for
 * the origin it actually talks to. It is NOT read from
 * `brand.generated.json`: that file is generated and must not be hand
 * edited, and the host is a deployment fact rather than a brand one.
 *
 * Only an https origin yields a host. A local dev build pointing at
 * `http://localhost:3000` or `http://10.0.2.2:3000` gets `null`, and
 * then no intent filter and no associated domain are written at all —
 * an app-link claim on `localhost` is nonsense, and an unverifiable
 * claim is worse than none.
 */
function siteHost() {
  const raw = (process.env.EXPO_PUBLIC_API_URL ?? "").trim();
  if (!raw.startsWith("https://")) return null;
  const host = raw.slice("https://".length).split("/")[0].split(":")[0];
  return host && host.includes(".") ? host : null;
}

/**
 * ⛔ iOS Universal Links for `/dispatch/*` — human-gated, and off by
 * default.
 *
 * `ios.associatedDomains` writes the `com.apple.developer.associated-
 * domains` entitlement into the binary, and an entitlement the
 * provisioning profile does not carry makes the BUILD fail — including
 * the free-provisioning "iPhone plugged into this Mac" recipe in
 * BUILDS.md, which is how this project builds for iOS today. Issuing
 * the capability needs the paid Apple Developer Program membership that
 * BUILDS.md records as a human step.
 *
 * So this follows the same shape as APPLE_MERCHANT_ID above: unset (the
 * default, and what every build in this repo does) writes no
 * entitlement and iOS opens the dispatch link in Safari — a complete,
 * working flow. Setting `APPLE_UNIVERSAL_LINKS=1` once the account and
 * the `apple-app-site-association` file exist is the only thing that
 * turns it on, plus a rebuild.
 */
const appleUniversalLinks = (process.env.APPLE_UNIVERSAL_LINKS ?? "").trim() === "1";

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

  /**
   * Android App Links for the delivery ticket's QR. `autoVerify` makes
   * Android check `https://<host>/.well-known/assetlinks.json` against
   * the installed app's signing certificate; until that file carries the
   * real fingerprint (BUILDS.md, "Deep links for the driver dispatch
   * QR") verification simply fails and the link opens in the browser,
   * which is the current behaviour and a complete flow.
   *
   * Merged rather than replaced, so a generated `android` block that
   * ever grows its own filters is not silently dropped.
   */
  const host = siteHost();
  if (host) {
    android.intentFilters = [
      ...(android.intentFilters ?? []),
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host, pathPrefix: "/dispatch" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ];
  }

  // ⛔ See `appleUniversalLinks` above: without the paid Apple account
  // this stays absent, and the entitlement is never written.
  const ios = { ...config.ios, ...generated.ios };
  if (host && appleUniversalLinks) {
    ios.associatedDomains = [
      ...(ios.associatedDomains ?? []),
      `applinks:${host}`,
    ];
  }

  return {
    ...config,
    ...generated,
    ios,
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
