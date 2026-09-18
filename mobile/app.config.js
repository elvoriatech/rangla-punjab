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

module.exports = ({ config }) => {
  const generated = brand.expo ?? {};
  const android = { ...config.android, ...generated.android };
  // The generated adaptive icon replaces the static one wholesale — mixing a
  // generated foreground with a stale monochrome layer would ship two
  // different logos in one icon.
  if (generated.android?.adaptiveIcon) android.adaptiveIcon = generated.android.adaptiveIcon;

  const plugins = [...(config.plugins ?? []), "expo-localization", "expo-secure-store"];
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
    extra: { ...config.extra, ...generated.extra },
  };
};
