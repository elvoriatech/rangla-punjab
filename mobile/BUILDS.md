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

The owner-supplied originals both brand marks are cut from live in
`mobile/assets/source/` — `app-icon.jpeg` (the artwork carrying the
"R·P RESTAURANT" lettering, the launcher icon) and `logo.jpeg` (the same
artwork without lettering, the in-app logo). Everything else is derived, so
swapping which one plays which role is: copy the other file over
`public/brand/rangla-punjab-mobile-app-icon.jpeg`, re-run `set-venue-logo`
below with the other one, then `pnpm brand:mobile --venue rangla-punjab`.

### The in-app logo lives in the database

The header, welcome and account marks are rasterised from
`venues.branding.logoKey` — an uploaded blob, not a file in the repo — so
dropping a new logo into `public/brand` changes nothing until it is ingested.
Dashboard → Settings → Logo does that; so does

```sh
pnpm exec tsx --env-file=.env scripts/set-venue-logo.ts rangla-punjab mobile/assets/source/logo.jpeg
```

which runs the same normalise → store → `logoKey` → CDN-purge path the
dashboard form does. Re-run `pnpm brand:mobile --venue rangla-punjab`
afterwards to pull the new mark into `assets/generated/`.

An **opaque** logo (one with a background, like this venue's) means no Android
themed-icon layer: `scripts/brand-mobile.ts` only emits
`adaptive-monochrome.png` for a logo with transparency, because a monochrome
pass over an opaque rectangle renders as a grey box.

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
the venue's key is a `pk_test_` key.

⛔ **Production Google Pay is human-gated.** It needs the app approved in
the **Google Pay & Wallet Console**:
1. Create a Google Pay business profile (business name, support contact,
   logo).
2. Submit an integration request for the release package name
   `com.elvoria.ranglapunjab`, attaching screenshots of the whole payment
   flow.
3. Wait for approval, then switch the venue's Stripe key to a live key —
   `testEnv` follows the key (`pk_test_` ⇒ test), so there is nothing to
   rebuild.

Until then a production build shows Google's test cards only.

**The standalone wallet button** (`PlatformPayButton`, above the payment
list in the cart — P7-13) is drawn only when
`isPlatformPaySupported()` answers true, and it confirms only a real
Stripe PaymentIntent — the dev/CI fake provider falls back to the
labelled "Simulate payment (test)" button exactly as the card route does.
Note one honest limitation: on **Android** that check needs the Stripe SDK
to have been initialised, and the publishable key only arrives with a
PaymentIntent — so the Google Pay button does not appear before the first
card payment of a session. That is deliberate: it is better than drawing a
button that opens a sheet which cannot be paid. Google Pay is still
offered inside the payment sheet on every attempt.

**3-D Secure** returns to `<scheme>://stripe-redirect` (`ranglapunjab://stripe-redirect`).
The scheme comes from `brand.generated.json` via `expo-constants`; nothing
to register by hand, but a venue rebranded to a different scheme gets the
new return URL automatically.

**Dev / CI.** When the server has no payment provider configured it mints a
**fake** intent (`mode: "fake"`), which has no sheet at all. The app then
shows a clearly-labelled "Simulate payment (test)" button that calls
`POST /api/orders/{id}/pay/confirm`. It can never appear against a real
Stripe account.

⛔ **Apple Pay is human-gated.** The code is wired and waiting; the only
thing missing is the merchant id, and everything Apple-Pay-shaped stays
invisible until it is set. To enable it:

1. Create the merchant id `merchant.com.elvoria.ranglapunjab` in the Apple
   Developer account.
2. Generate the Apple Pay payment-processing certificate from Stripe and
   upload it in the Apple Developer portal (Stripe Dashboard → Settings →
   Payments → Apple Pay).
3. Build with the env var set — that is the **one** switch:
   ```bash
   APPLE_MERCHANT_ID=merchant.com.elvoria.ranglapunjab npx expo run:ios …
   ```
   or add it to the build profile's `env` block in `eas.json`.
4. Rebuild and resubmit: the entitlement is part of the binary.

What the env var does, all in `app.config.js`:
- writes `merchantIdentifier` into the `["@stripe/stripe-react-native", …]`
  plugin options, which writes the `com.apple.developer.in-app-payments`
  entitlement;
- sets `extra.applePayEnabled = true` and `extra.appleMerchantId`, which is
  what `src/payments.ts` reads to pass `merchantIdentifier` to `initStripe`,
  to add `applePay: { merchantCountryCode: "DE" }` to `initPaymentSheet`,
  and to allow the standalone Apple Pay button in the cart.

Unset — the default for every build in this repo today — none of those
happen and the checkout looks exactly as it did before P7-13.

## Push notifications to the owner's phone

The restaurant's phone gets a notification when an order lands or a guest
reports a problem. Guests are never pushed to: `src/push.ts` does nothing
at all unless a **staff session** exists, so a guest device never sees a
permission prompt.

**Transport is the Expo Push API.** The app registers an Expo push token
(`ExponentPushToken[…]`) with `POST /api/v1/staff/devices`
(`{ token, platform, appVersion }`, `X-Staff-Token`); signing out of
restaurant mode `DELETE`s the same token. The server posts to
`exp.host/--/api/v2/push/send` and **Expo** talks to APNs and FCM — there
is no Firebase SDK and no APNs key in this repo.

The token is attributed to the EAS project id in `app.json`
(`extra.eas.projectId`). A build without one registers nothing, silently.

**Tapping a notification** routes on its `data.kind`: `"order"` opens the
Board tab, `"issue"` opens Complaints with that thread already open. A
push that arrives while the app is open refreshes the board instead of
navigating. A cold start from a tap is handled too
(`getLastNotificationResponse`).

⛔ **Native rebuild required** — `expo-notifications` and `expo-device` are
native modules, so the currently installed APK/IPA will not register a
token. Rebuild (see below) after pulling this change.

⛔ **Human-gated credentials — until these are uploaded the app registers a
token and nothing is ever delivered.** That is the intended degraded
state; no code change is needed afterwards.

1. **iOS — APNs key.** In the Apple Developer account create an "Apple
   Push Notifications service (APNs)" key (.p8), then upload it to EAS:
   ```bash
   cd mobile
   eas credentials            # iOS → the build profile → Push Notifications: Manage your Apple Push Notifications Key
   ```
   Also needs a paid Apple Developer Program membership: the
   personal-team local build below cannot carry the `aps-environment`
   entitlement.
2. **Android — FCM service account.** Create a Firebase project for the
   package `com.elvoria.ranglapunjab`, download the **service-account
   JSON** (Project settings → Service accounts → Generate new private
   key) and upload it to EAS:
   ```bash
   eas credentials            # Android → the build profile → Google Service Account → FCM V1
   ```
3. **Server** — set `EXPO_PUSH_ENABLED` (and optionally
   `EXPO_ACCESS_TOKEN`). Unset, the server uses its in-memory fake
   provider and sends nothing.

## Printing kitchen tickets

The board prints an order's ticket to any printer the device can already
reach: **AirPrint** on iOS, the **Android print framework** on Android,
the browser's own print dialog on web. There is no printer driver, no
Bluetooth pairing and no IP address to configure in the app — if the
tablet can print a web page, it can print a ticket.

The ticket itself is rendered **by the server**: `GET
/api/v1/staff/orders/{id}/ticket` (`X-Staff-Token`) returns one
self-contained HTML document, and `src/print.ts` hands it straight to the
platform. Changing what a ticket looks like is therefore a server change,
not an app release.

Two ways in, both on the Board:

- **🖨 Print** on an opened order card — one ticket, on demand.
- **Auto-print new orders** — a switch above the board, **off by
  default**. While it is on, every order the board detects as new (the
  same detection that lights the card gold and buzzes the phone) prints
  once. Turning it on does *not* print the orders already on the board;
  they are baselined instead. The ids that have printed are kept in
  AsyncStorage (capped at 200), so relaunching the app mid-service never
  re-spools the backlog.

⛔ **Native rebuild required** — `expo-print` is a native module, so the
currently installed APK/IPA cannot print. Rebuild (see below) after
pulling this change. Nothing else is gated: no credentials, no server
flags, no store review implications.

## Orientation: the app rotates now

`app.json` → `"orientation": "default"` (was `"portrait"`).

**Why.** The restaurant half of the app lives on a counter tablet, usually
in landscape, and Expo's prebuild only ever wrote landscape into
`UISupportedInterfaceOrientations~ipad` — so the **iPad already rotated**,
while Android tablets were locked to portrait by
`android:screenOrientation`. `"default"` removes the lock on both
platforms (`UISupportedInterfaceOrientations` gains
`LandscapeLeft`/`LandscapeRight` for iPhone, and the Android attribute
becomes unspecified).

**The trade-off, and why it was taken.** `"default"` also unlocks
landscape on phones, including for guests. Every guest screen is already
a `ScrollView` and degrades to "shorter, still scrollable" — except the
launch screen, which was a centred non-scrolling stack and would have
clipped. It scrolls now (`WelcomeScreen`), which was the only fix
landscape needed. The alternative — keeping portrait and locking phones
at runtime with `expo-screen-orientation` — was rejected as a second
native module and a second source of truth for one screen's worth of
layout.

Restaurant screens use the width rather than just tolerating it
(`src/layout.ts`): the Board is a 2-column card grid from 700 pt and 3
from 1000 pt, owner screens cap their content at 720 pt and centre it,
and the floating tab bar stops growing at 560 pt.

⛔ **Rebuild required** — orientation is baked into `Info.plist` and
`AndroidManifest.xml`. `mobile/ios` and `mobile/android` are generated and
git-ignored, so this takes effect on the next `npx expo prebuild` /
`eas build`; an existing install keeps the old lock.

## Rebuild and install for testing

Native modules (Stripe payment sheet, Google sign-in, push notifications,
printing) are in the app now, so **Expo Go cannot run it** — every test
install is a real build.

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

⛔ **Touched `app.json` / `app.config.js`? Prebuild first.** `expo run:ios`
does **not** re-run prebuild when `mobile/ios` already exists, so anything a
config plugin writes into the native project — permission strings, `scheme://`,
icons, a new native module's settings — silently never reaches the phone. Run
this before `expo run:ios` after **any** change to plugins, `infoPlist`
entries, permissions, scheme, icons, or after adding a native module that
ships a config plugin:

```bash
cd mobile
npx expo prebuild -p ios --no-install       # --no-install keeps the cached Pods
grep -n UsageDescription ios/RanglaPunjabRestaurant/Info.plist
```

The `grep` is the proof: every permission the app asks for must have a
non-empty string there. This bit us once already — the camera killed the app
on launch because `expo-image-picker`'s plugin was in `app.json` but
`NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` were missing
from the generated plist; iOS terminates the process rather than showing the
prompt. Two harmless side effects: `mobile/ios` is git-ignored so the
regenerated project never shows up in a diff, and prebuild rewrites the
`ios` / `android` scripts in `mobile/package.json` to `expo run:*` — leave it.
**EAS builds (local or cloud, Android or iOS) prebuild from scratch every
time, so they always pick plugin changes up on their own.**

That prebuild also costs you the build on a **free personal Apple team**: the
`expo-notifications` config plugin writes `aps-environment` into
`ios/RanglaPunjabRestaurant/RanglaPunjabRestaurant.entitlements`, and a personal team cannot sign
the Push Notifications capability, so `expo run:ios` dies with "Provisioning
Profile … does not support the Push Notifications capability". Strip the
entitlement after every prebuild, before building locally:

```bash
plutil -remove aps-environment ios/RanglaPunjabRestaurant/RanglaPunjabRestaurant.entitlements
```

Push simply stays inactive on that install — which it is anyway without an
APNs key — and EAS builds sign with the paid team, so they keep the
entitlement untouched.

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

#### Testing restaurant mode and loyalty

- **Restaurant mode.** On the Account tab sign in with the *dashboard* owner
  credentials (`OWNER_EMAIL` / `OWNER_PASSWORD`). The tab bar turns into
  Home · Menu · Board · Account and the Board opens on the live orders. Place a
  guest order from another device (or the website) and watch it arrive within
  ten seconds, with a vibration and a highlight; tap a status button and check
  the dashboard moved with it. **Call** and **Directions** hand off to the
  phone and maps apps. Signing in with a guest account must show none of this.
- **Loyalty** only appears once Dashboard → Settings → **Loyalty** is switched
  on. Sign in as a guest, place an order over the minimum, and watch the points
  land on the Rewards card when the order settles (cash counts when the kitchen
  marks it done). At the threshold the "Hurra" email arrives and a voucher
  appears — arm it in the **Check my reward** popup, then start the next order
  in the app: the cart previews the reward, the button shows the discounted
  total, and an order the reward covers entirely skips the payment step.
- `expo-keep-awake` was added for the Board (it keeps a counter tablet's screen
  on). It is a **native module**, so an existing install has to be rebuilt —
  a JS-only reload won't pick it up.
- **Complaints** (guest: "Report a problem" on the tracking screen; owner:
  the burger's **Complaints** entry and the ⚠️ pill on a Board card). The
  guest can attach one photo per message, which means `expo-image-picker` —
  a **native module** with an iOS photo-library usage string, so an existing
  install has to be **rebuilt** (`expo run:ios` / an EAS build); an OTA
  update cannot deliver it. The permission is asked lazily, on the first tap
  of "Add photo", so a guest who never attaches one is never asked. To test:
  place an order, open it from **Orders**, tap **Report a problem**, send text
  and a photo, then sign in as the restaurant and answer from the Board pill
  or the Complaints list — the guest's screen shows the reply and the pill
  turns to "Answered", and **Mark resolved** makes the thread read-only for
  the guest while the card keeps its pill.
- **Photo source.** "Add photo" now asks **Take photo** or **Choose from
  library**. The camera needs its own permission (`cameraPermission` in the
  `expo-image-picker` plugin config), also asked lazily and only if the
  camera is the source chosen — so a guest who always picks from the library
  is never asked for the camera at all. Both paths apply the same size cap
  and JPEG re-encode. A guest can also reach the thread straight from the
  **Orders** list now, without opening the tracking screen first.

#### Testing the owner's new screens

- **Opening hours** (burger → *Opening hours*). Closed switch per day, up to
  two open/close windows on the 15-minute grid, **Copy Monday to Tue–Fri**,
  and an **Open now** pill that comes from the server — it is the *venue's*
  timezone, so it will not follow a tablet whose clock is set wrong. Save,
  then check the public menu agrees. A refused day is highlighted on its own
  row.
- **Loyalty** (burger → *Loyalty*). The programme switch at the top saves
  itself the moment it moves and reverts if the server refuses. The
  **Programme settings** below it edit the five numbers; euro fields accept
  a comma, and a refused field is marked individually.
- **Dish name and description** are editable in the Menu tab's edit sheet
  (restaurant mode) — they used to point at the web dashboard.
- **Dish photo.** The same edit sheet now opens on the dish's picture with
  **Change photo** (→ *Take photo* / *Choose from library*, the guest
  complaint sheet's chooser, shared in `src/photo.ts`) and **Remove photo**.
  Both are LIVE and immediate — they do not wait for *Save* — and the row
  behind the sheet shows the new picture as soon as the server answers.
  Before uploading, the app shrinks the picked image to a longest edge of
  **1600 px** and re-encodes it as **JPEG at quality 0.82**, so a 4 MB camera
  frame leaves the counter as roughly 200–400 KB. Routes:
  `POST|DELETE /api/v1/staff/items/{id}/photo` (`X-Staff-Token`, multipart
  field `photo`, JPEG/PNG/WebP, 10 MB cap). To test: edit a dish, take a
  photo, confirm the menu row and the *guest* menu both show it, then remove
  it and confirm the empty tile comes back.

  ⛔ **Native rebuild required** — `expo-image-manipulator` (~57.0.19) is a
  **native module**, so the currently installed APK/IPA cannot downscale and
  the feature will fail on the picked image. Rebuild (`npx expo prebuild` +
  `expo run:ios` / an EAS build) after pulling this change; an OTA update
  cannot deliver it. No new permission: the camera and photo-library strings
  from `expo-image-picker` already cover it.
- **Open / Closed** now shows as a coloured dot plus the word in the header.
  It only renders when the server says; behind the counter it reflects the
  live state from `/api/v1/staff/hours`.
- **Tablet.** Turn the tablet on its side: the Board should go to two
  columns (three on a big one), the owner screens should stay a centred
  column rather than stretching, and the tab bar should stop growing.
- **New-order chime.** The Board now *sounds* when an order lands, beside the
  gold highlight and the buzz: one 1.5 s two-tone ding
  (`assets/sounds/new-order.mp3`, ~18 KB, bundled — it works with no network).
  The **"Sound for new orders"** switch sits under the auto-print switch in the
  same card above the board, defaults **ON**, and is remembered per device
  (`rangla-new-order-sound`). It rings once per poll however many orders that
  poll carried, never on the first read after opening the Board, and never on
  a guest device (the Board is restaurant-only). A push arriving in the
  foreground re-reads the board, so it chimes on that path too. To test: open
  the Board on the tablet, place an order from another phone, and listen —
  then put the tablet on **silent** and do it again (the chime is configured
  to play in silent mode, and to mix with rather than stop the kitchen radio).

  ⛔ **Native rebuild required** — `expo-audio` (~57.0.5) is a **native
  module**, so the currently installed APK/IPA has no audio engine and the
  switch will simply stay quiet. Rebuild (`npx expo prebuild` + `expo run:ios`
  / an EAS build) after pulling this change; an OTA update cannot deliver it.
  **No new permission:** the `expo-audio` config-plugin entry in `app.json`
  passes `microphonePermission: false` + `recordAudioAndroid: false`, so no
  `NSMicrophoneUsageDescription` and no `RECORD_AUDIO` are written — playback
  only. `enableBackgroundPlayback: false` likewise keeps the `audio`
  background mode and the media-playback foreground service out of the build;
  a chime has nothing to play while the app is closed.

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

## Known crash: the Google Pay probe before `initStripe`

**Symptom.** On Android, the app dies the moment the guest opens the Cart —
a hard process crash, no JS error, nothing in the Metro log. Builds v9–v11
were affected wherever the venue had online payment on. v12 only escaped it
because Google Pay was not ticked in Settings → Payment methods yet.

**Cause.** `isPlatformPayAvailable()` in `src/payments.ts` is called when the
cart mounts, and it called `stripe.isPlatformPaySupported()`. On Android that
constructs a `GooglePayPaymentMethodLauncher`, whose constructor calls
`PaymentConfiguration.getInstance()`. If `initStripe` has never run in this
process, that throws `IllegalStateException("PaymentConfiguration was not
initialized. Call PaymentConfiguration.init().")` **on the main thread** —
so it is a process crash, not a rejected promise, and the `try/catch` around
the call is powerless. The RN module's `isPlatformPaySupported` has no
`::stripe.isInitialized` guard, unlike `confirmPlatformPay`. A guest who has
not paid by card yet in that app session has never initialised the SDK, which
is every guest opening the cart for the first time.

**Fix (shipped).** `isPlatformPayAvailable` now fetches
`GET /api/v1/pay/wallet-config` on Android first. A null `publishableKey`
(no real Stripe account, fake provider, Connect fee model) returns false
without probing at all; otherwise the key goes through `ensureStripeInit()`
— which also backs `payWithCard` and `payWithPlatformPay`, and caches the
last key so the remount-per-tab-switch does not re-init — and only then is
the probe made, with `googlePay.testEnv` derived from `pk_test_`.

**Do not remove the init.** Any new caller of `isPlatformPaySupported`, or of
anything else that builds a native Stripe launcher, must initialise first.
The seam in `src/stripe-module.ts` carries the same warning.

---

## ⛔ Deep links for the driver dispatch QR (human step)

A delivery ticket's QR now encodes `https://<site>/dispatch/{orderId}?t=…`
(see `src/lib/dispatch-service.ts`). Scanning it flips the order to
"out for delivery" and forwards to Google Maps.

**The web page works today, on any phone, with no setup.** Everything below
is the optional upgrade that makes a phone with the staff app installed open
that URL *in the app* instead of the browser — one fewer bounce for a driver
holding two bags. Nothing breaks without it.

### Android — `assetlinks.json` (we can finish this ourselves)

`public/.well-known/assetlinks.json` is already in the repo with the right
package name (`com.elvoria.ranglapunjab`) and a placeholder fingerprint. To
activate it:

1. Get the SHA-256 of the signing key the installed app is actually built
   with. For an EAS-managed keystore:

   ```
   cd mobile && eas credentials
   # → Android → production → Keystore → "Download"/"View" the
   #   SHA-256 Certificate Fingerprint
   ```

   If the app ships through Google Play with Play App Signing, use the
   fingerprint Play shows under **Release → Setup → App signing →
   App signing key certificate** — that is the key users' devices verify,
   and the upload key will NOT match.

2. Paste it into `sha256_cert_fingerprints`, replacing
   `REPLACE_WITH_EAS_UPLOAD_KEY_SHA256`. Format is upper-case hex pairs
   separated by colons (`AB:CD:…`).

3. Deploy, then confirm the file is served from the site root as
   `application/json` over HTTPS with **no redirect**:

   ```
   curl -sSI https://<site>/.well-known/assetlinks.json
   ```

   Google's verifier follows no redirects and accepts no 3xx.

4. Verify on a device: `adb shell pm verify-app-links --re-verify
   com.elvoria.ranglapunjab`, then
   `adb shell pm get-app-links com.elvoria.ranglapunjab` — the domain must
   read `verified`.

Until step 2 is done the file is inert: Android simply fails verification
and opens the browser, which is the current behaviour anyway.

### iOS — associated domains (needs the paid Apple account)

Universal Links require an `apple-app-site-association` file AND the
`applinks:<site>` entitlement, and the entitlement can only be issued
through an Apple Developer Program membership ($99/yr) that this project
does not have yet. Until it does, iOS opens the dispatch link in Safari —
which is a complete, working flow.

When the account exists:

1. Add to `mobile/app.config.js`:
   `ios.associatedDomains = ["applinks:<site>"]`.
2. Serve `https://<site>/.well-known/apple-app-site-association` (no
   extension, `application/json`, no redirect) with the `appID`
   `<TEAM_ID>.com.elvoria.ranglapunjab` and the path `/dispatch/*`.
3. Rebuild — the entitlement is baked into the binary, so this needs a new
   build, not just a deploy.

## App display name + launch screen (2026-09-22)

- The launcher name is **"Rangla Punjab Restaurant"** (owner). It lives in
  `brand.generated.json` → `expo.name`; the next `pnpm brand:mobile` run must
  pass `--name "Rangla Punjab Restaurant"` or it reverts to the short name.
  Home screens truncate long names (≈ "Rangla Punjab…"); install dialogs,
  Settings and the stores show it in full.
- The launch screen comes from the `expo-splash-screen` plugin in
  `app.config.js` (SDK 52+ ignores the root `splash` key): the mascot in a
  white/gold medallion (`assets/splash-medallion.png`) on the brand red.
  Native change → `npx expo prebuild` (+ `LANG=en_US.UTF-8 pod install` on
  iOS) and a rebuild; an OTA update cannot change it.
