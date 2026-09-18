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

module.exports = ({ config }) => {
  const generated = brand.expo ?? {};
  const android = { ...config.android, ...generated.android };
  // The generated adaptive icon replaces the static one wholesale — mixing a
  // generated foreground with a stale monochrome layer would ship two
  // different logos in one icon.
  if (generated.android?.adaptiveIcon) android.adaptiveIcon = generated.android.adaptiveIcon;

  return {
    ...config,
    ...generated,
    ios: { ...config.ios, ...generated.ios },
    android,
    web: { ...config.web, ...generated.web },
    extra: { ...config.extra, ...generated.extra },
  };
};
