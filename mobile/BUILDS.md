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

### Launcher icon

The app icon is normally the venue logo on the brand red. To ship a finished
icon instead, drop a **square** PNG/JPEG (1024px or larger) at
`public/brand/<venue-slug>-mobile-app-icon.{png,jpg,jpeg}` — for this venue
`public/brand/rangla-punjab-mobile-app-icon.jpeg` — and run
`pnpm brand:mobile --venue <slug>` as usual (or pass `--icon <path>`). Only
the launcher icon changes: iOS gets it edge to edge (iOS applies its own
rounded mask), Android's adaptive foreground gets it on a white ground so the
launcher's circle crop trims only the artwork's white margin. Splash, favicon
and the in-app logo still come from the venue logo. An icon change is a
**native** change: rebuild the app (`expo run:ios` / EAS), an OTA update
cannot deliver it.

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

## Payments in the app

The guest picks a payment method in the cart **before** placing the order.
Cash places and stops; card and PayPal place the order first (a declined
card must never cost someone their basket) and pay immediately after.

**Card / Google Pay — the native sheet.**
`@stripe/stripe-react-native` is a native module, so it does **not** exist
in Expo Go or on web. It is loaded through `src/stripe-module.ts` /
`src/stripe-module.web.ts`, which hand back `null` instead of throwing —
a plain lazy `require()` was not enough, because Metro follows requires
statically and the web export failed on the package's native specs. When
the module is absent the app falls back to the hosted checkout page opened
in Custom Tabs / SFSafariViewController (`expo-web-browser`), which is also
where PayPal lives. So Expo Go still pays, just through the browser.

**No publishable key is baked into the build.** `POST /api/orders/{id}/pay/intent`
returns it alongside the client secret, so moving the venue from Stripe
test keys to live keys is a server change — no rebuild, no resubmission.

**Google Pay** is enabled by the config plugin in `app.config.js`
(`enableGooglePay: true` writes the `com.google.android.gms.wallet.api.enabled`
manifest flag). The sheet runs against Google's **test environment** while
the venue's key is a `pk_test_` key. Production Google Pay additionally
needs the app approved in the **Google Pay & Wallet Console** (Business
profile + an integration request against the release package name) — until
then a production build shows test cards only.

**3-D Secure** returns to `<scheme>://stripe-redirect` (`ranglapunjab://stripe-redirect`).
The scheme comes from `brand.generated.json` via `expo-constants`; nothing
to register by hand, but a venue rebranded to a different scheme gets the
new return URL automatically.

**Dev / CI.** When the server has no payment provider configured it mints a
**fake** intent (`mode: "fake"`), which has no sheet at all. The app then
shows a clearly-labelled "Simulate payment (test)" button that calls
`POST /api/orders/{id}/pay/confirm`. It can never appear against a real
Stripe account.

⛔ **Apple Pay is human-gated and deliberately not wired.** To enable it:
1. Create the merchant id `merchant.com.elvoria.ranglapunjab` in the Apple
   Developer account.
2. Generate the Apple Pay payment-processing certificate from Stripe and
   upload it in the Apple Developer portal (Stripe Dashboard → Settings →
   Payments → Apple Pay).
3. Add `merchantIdentifier: "merchant.com.elvoria.ranglapunjab"` to the
   `["@stripe/stripe-react-native", { … }]` plugin options in
   `app.config.js` — that writes the `com.apple.developer.in-app-payments`
   entitlement.
4. Pass `applePay: { merchantCountryCode: "DE" }` to `initPaymentSheet` in
   `src/payments.ts`.
5. Rebuild and resubmit: the entitlement is part of the binary.

## Rebuild and install for testing

Native modules (Stripe payment sheet, Google sign-in) are in the app now, so
**Expo Go cannot run it** — every test install is a real build.

### iPhone plugged into this Mac (free, no Apple Developer Program)

Xcode 26 + CocoaPods are installed and the Mac holds one "Apple Development"
certificate, so a personal-team build installs on a paired iPhone:

```bash
cd mobile
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8          # CocoaPods crashes without a UTF-8 locale
xcrun xctrace list devices                          # copy the phone's UDID (00008101-…)
EXPO_PUBLIC_API_URL=https://rangla-punjab-restaurant.de \
  npx expo run:ios --device 00008101-00120C411AD8001E --configuration Release --no-bundler
```

- `--configuration Release` embeds the JS bundle, so the phone runs the app
  without Metro. Drop `--no-bundler` and use `Debug` only when you want live
  reload from this Mac.
- The phone must be **unlocked** for the install step. On the very first
  install iOS refuses to launch until you trust the developer: Settings →
  General → VPN & Device Management → Developer App → Trust.
- A personal-team signature expires after **7 days**; rerun the command to
  reinstall. A paid Apple Developer account lifts that to a year.
- `EXPO_PUBLIC_API_URL` is baked into the binary. For the Mac's dev server
  use `http://<mac-lan-ip>:<port>` (`ipconfig getifaddr en0`; the port
  `pnpm dev` picked) with the phone on the same Wi-Fi.
- **Changing that URL between two builds needs a clean Metro cache.** The
  value is inlined into `main.jsbundle` at bundle time and Metro's transform
  cache does not key on it, so a Release rebuild happily reuses the file
  with the previous URL inside (Xcode also skips the bundle phase when its
  inputs look unchanged). Before rebuilding with a different URL:
  `rm -rf "$TMPDIR/metro-cache"` and
  `rm -rf ~/Library/Developer/Xcode/DerivedData/RanglaPunjab-*/Build/Products/Release-iphoneos/RanglaPunjab.app/{main.jsbundle,assets}`.
  Always check what got baked before trusting an install:
  `grep -a -o 'https://rangla-punjab-restaurant.de\|http://192[0-9.:]*' …/RanglaPunjab.app/main.jsbundle`.
- If `expo run:ios` sits on "Connecting to: <phone>" after "Build Succeeded",
  stop it and install the built app directly:
  `xcrun devicectl device install app --device <UDID> …/Release-iphoneos/RanglaPunjab.app`
  then `xcrun devicectl device process launch --terminate-existing --device <UDID> com.elvoria.ranglapunjab`.
- Pods are cached after the first run; a rebuild takes a few minutes, the
  first one closer to twenty (CocoaPods clones the Stripe iOS repo).

### Android APK from the cloud (EAS, free Expo account)

```bash
cd mobile
npx eas-cli login                                   # once; zahoor1989 is already logged in here
npx eas-cli build -p android --profile preview --no-wait
npx eas-cli build:list --platform android --limit 1 # status + download link when done
```

The result is a build page on expo.dev with a **download link and QR code**;
open it on the phone, install the APK, allow "install from unknown sources".
The `preview` profile already points at production
(`EXPO_PUBLIC_API_URL=https://rangla-punjab-restaurant.de`) and reuses the
keystore EAS holds for this project, so every APK updates the previous one
in place. Empty-string values are not allowed in `eas.json` `env` — leave a
variable out rather than setting it to `""`.

### iOS build from the cloud

Needs the Apple Developer Program ($99/yr):
`npx eas-cli build -p ios --profile preview`, then install via the link.

### What to test after installing

Cart → pick **Card / Google Pay**, **PayPal** or **Cash** → Pay. With Stripe
test keys on the server the card sheet opens; test card `4242 4242 4242 4242`,
any future date, any CVC. `4000 0025 0000 3155` forces a 3-D Secure challenge
and must return to the app. The order must flip to "Paid" on the tracking
screen and the kitchen ticket email must arrive only then. Server without any
Stripe key ⇒ the labelled **Simulate payment (test)** button instead.

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
| Privacy policy URL | both | Must cover Stripe, PayPal, Google sign-in and the order data the app sends; the `/legal/*` pages still carry `TODO: legal review` and need counsel sign-off first |
| Play **Data safety** form | Play | Declares: name, phone, email, delivery address, payment info handled by Stripe/PayPal, no ads, data encrypted in transit |
| Apple **App Privacy** labels | App Store | Same categories as above, entered in App Store Connect |
| Stripe **live** keys on the server | both | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` in `prod.env` (or Dashboard → Payments); webhook subscribed to `checkout.session.completed` + `payment_intent.succeeded`; one €0.50 live order before release |
| Google Pay production access | Play | Google Pay & Wallet Console: register the app (package + release SHA-1), pass the integration review; until then Google Pay works only with test cards |
| Apple Pay | App Store | Merchant ID `merchant.com.elvoria.ranglapunjab` + Apple Pay certificate in Stripe, then `merchantIdentifier` in `app.config.js` — see "Payments in the app" |
| Google OAuth clients | both | Web + iOS + Android client ids in `eas.json`, `GOOGLE_MOBILE_CLIENT_IDS` on the server — see "One-tap Google sign-in"; without them the app uses browser sign-in |
| PayPal live app | both | Live client id/secret + webhook id in Dashboard → Payments, `PAYPAL_ENV=live` |

`submit.production` in eas.json is intentionally empty until those exist.

### App-side changes for a store release

- **Version:** `pnpm brand:mobile --venue rangla-punjab --version 1.1.0` in the
  repo root, commit `brand.generated.json`. Build numbers are EAS-managed.
- **Profiles:** `production` builds an AAB (Play) / IPA (App Store); `preview`
  builds a sideloadable APK. Both bake `https://rangla-punjab-restaurant.de`.
- **Server first:** the app calls `POST /api/orders/{id}/pay/intent`, which
  must be deployed before a build that relies on it reaches guests (older
  servers make the app fall back to the hosted checkout page, so a mismatch
  degrades rather than breaks).
- **Play:** the first upload must be done by hand in the Play Console (create
  the app, upload the first AAB, fill Data safety + content rating); after
  that `eas submit -p android --latest` works with the service-account JSON.
- **App Store:** create the app record with bundle id
  `com.elvoria.ranglapunjab`, upload screenshots for 6.7" and 6.1" iPhones,
  set the age rating, then `eas submit -p ios --latest`.
- **Review notes:** give both stores a test login and say the Cash option
  lets a reviewer place an order without paying.

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
