# Building installable apps (Android APK / iOS)

The API base URL is baked at BUILD time via `EXPO_PUBLIC_API_URL` (see eas.json)
— set it before building; an installed app cannot be re-pointed later.

## Brand the app for a venue FIRST

This app is white-label: one build per restaurant, and everything venue-shaped
is generated from that venue's row. Run this in the repo root before any build:

```bash
pnpm brand:mobile --venue <slug>
```

It reads `venues.branding` (menu theme, logo, banner, backdrop) and writes:

| Output | Consumed by |
| --- | --- |
| `brand.generated.json` | `app.config.js` → app name, slug, `scheme://`, version, store ids, icon/splash/adaptive icons |
| `src/brand.generated.ts` | `src/theme.ts` → palette, venue name, logo + hero assets, hero scrim |
| `assets/generated/*` | icon, adaptive icon layers, splash, favicon, logo, hero artwork |

Nothing in those files should be hand-edited — the next run overwrites them.
`app.json` keeps only the venue-independent config (orientation, plugins,
tablet support). `--dry-run` prints the palette, its WCAG contrast table and
the file list without writing; `--help` lists every flag (`--theme`, `--logo`,
`--hero`, `--bundle-prefix`, `--version`, `--no-db`, …).

Palette, icons and scrim are derived, not guessed: the colours are solved from
the venue's menu theme until every pairing the screens render (ink on cards,
accent on chrome, label on the CTA fill) clears WCAG AA, and the hero scrim's
opacity is solved against the artwork this build actually ships. A venue with
no uploaded logo gets an initials monogram; with no backdrop or banner, a
gradient painted from its palette.

Still bundled per-restaurant by hand: `assets/ornament.png` and
`assets/carousel/*` (the four dish plates on the home hero). Those want the
venue's own dish photos from `/api/v1/menu` — not done yet.

Native splash: the top-level `splash` key is what this Expo version reads for
the web/PWA path. Add `expo-splash-screen` when a native splash is needed; the
generated splash asset is already sized for it.

## Languages, RTL and Google sign-in

### Guest languages
The app ships copy in **English, German, Italian, Spanish and Arabic** —
the same five the website calls `UiLocale` (`src/lib/locales.ts`). The
picker on the Konto/Account screen only lists the languages the VENUE has
enabled (`enabledLocales` from `/api/v1/menu`), intersected with those
five; a locale the venue enables but the app has no copy for (fr, nl, …)
still translates the dish text server-side and keeps English chrome.

With no stored choice the app follows the device language, narrowed the
same way, then the venue's `defaultLocale`, then English.

**Arabic is right-to-left.** Layout direction is a native, process-wide
flag, so switching to or away from Arabic calls `I18nManager.forceRTL()`
and RELOADS the app via `expo-updates`. In Expo Go or a dev client with
updates disabled, `reloadAsync()` is unavailable and the app instead asks
the guest to close and reopen it — so test RTL in a dev/EAS build, not in
Expo Go. Nunito and Playfair are Latin-only, so an RTL build swaps the
whole type scale to the platform UI font (weights via `fontWeight`); that
switch lives in `src/theme.ts` and needs no per-screen changes.

### One-tap Google sign-in
`@react-native-google-signin/google-signin` — a **native module**, so it
does NOT work in Expo Go. Expo Go and any build without the client ids
below fall back to the existing browser device-code flow, which is why
nothing regresses before the credentials exist.

| Build var | Where it comes from | Used by |
| --- | --- | --- |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Cloud → OAuth client, type **Web** | Android sign-in + the ID token audience |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | OAuth client, type **iOS** (bundle id `com.elvoria.ranglapunjab`) | iOS sign-in + the `iosUrlScheme` the config plugin registers |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | OAuth client, type **Android** (package + release SHA-1) | recorded for completeness; Android reads the web id at runtime |

They are placeholders (`""`) in every `eas.json` profile — fill them in
before a build that should have one-tap. `app.config.js` only adds the
Google config plugin when the iOS client id is set, and accepts it either
as `123-abc.apps.googleusercontent.com` or already reversed
(`com.googleusercontent.apps.123-abc`).

The server side is `POST /api/auth/customer/google`, which verifies the
ID token against Google's JWKS and upserts the customer — **registration
is implicit**: a guest's first Google tap creates the account. It answers
503 until the server itself has `GOOGLE_CLIENT_ID`, and the app then
falls back to the browser flow.

The customer token moved from AsyncStorage to `expo-secure-store`
(Keychain / EncryptedSharedPreferences); an existing AsyncStorage token
is migrated on first read, so nobody is signed out by the upgrade.

⛔ **Human-gated, cannot be automated from here:** creating the three
Google Cloud OAuth clients (including the Android release SHA-1 from the
EAS keystore), pasting them into `eas.json`, and setting `GOOGLE_CLIENT_ID`
/ `GOOGLE_CLIENT_SECRET` on the server.

## Android APK (sideloadable, no store needed)
```bash
cd mobile
npx eas-cli login          # free Expo account
npx eas-cli build -p android --profile preview
```
Result: a download link + QR. Open on the phone, tap the APK, allow
"install from unknown sources". `preview` builds an APK (sideloadable);
the Play Store later wants the `production` profile (AAB).

## iOS
An iPhone install needs an Apple Developer account ($99/yr) — build with
`npx eas-cli build -p ios --profile preview`, install via the link.
Simulator/dev testing needs none: `npx expo start` + Expo Go (what we run locally).

## Shipping to the stores

`eas.json` now points both store profiles at production
(`EXPO_PUBLIC_API_URL=https://rangla-punjab-restaurant.de`). That URL is baked
into the binary at build time — an installed app cannot be re-pointed, so a
build made against the wrong URL has to be rebuilt and resubmitted.

Store-ready builds (AAB for Play, IPA for App Store):

```bash
cd mobile
npx eas-cli build -p android --profile production
npx eas-cli build -p ios --profile production
```

Then submit:

```bash
npx eas-cli submit -p android --latest
npx eas-cli submit -p ios --latest
```

`autoIncrement` is on and `cli.appVersionSource` is `remote`, so EAS owns the
build numbers — do not bump them by hand. The user-facing `version` (1.0.0)
comes from `brand.generated.json`; change it with
`pnpm brand:mobile --venue rangla-punjab --version <x.y.z>`.

### What a human has to do first

None of this can be automated from here — each needs an account, a payment, or
a signing credential:

| Needed | For | Note |
| --- | --- | --- |
| Apple Developer Program | iOS build + submit | $99/yr |
| App Store Connect app record | `eas submit -p ios` | bundle id `com.elvoria.ranglapunjab` |
| Google Play Console account | Play submit | one-off $25 |
| Play service-account JSON | `eas submit -p android` | goes in `submit.production.android.serviceAccountKeyPath` |
| Store listing | both | screenshots, description, privacy-policy URL, content rating |

`submit.production` in eas.json is intentionally empty until those exist.

**Decide the publisher before the first submit.** Both ids are
`com.elvoria.ranglapunjab` — the platform's prefix, not the restaurant's. A
bundle id and its owning developer account cannot be changed after the first
release; republishing under a different one means a brand-new listing with no
reviews or installs. If these apps should live under the restaurant's own
developer account, regenerate with
`pnpm brand:mobile --venue rangla-punjab --bundle-prefix <prefix>` before
building.

## Local dev (what runs right now)
- Web app must be running on :3000 (`pnpm dev` in the repo root).
- `npx expo start --web --port 8082` — web preview at :8082, iOS simulator via
  `xcrun simctl openurl booted exp://127.0.0.1:8082`, Android emulator via
  `adb shell am start -a android.intent.action.VIEW -d exp://10.0.2.2:8082`.
