# Building installable apps (Android APK / iOS)

The API base URL is baked at BUILD time via `EXPO_PUBLIC_API_URL` (see eas.json)
— set it before building; an installed app cannot be re-pointed later.

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

## Local dev (what runs right now)
- Web app must be running on :3000 (`pnpm dev` in the repo root).
- `npx expo start --web --port 8082` — web preview at :8082, iOS simulator via
  `xcrun simctl openurl booted exp://127.0.0.1:8082`, Android emulator via
  `adb shell am start -a android.intent.action.VIEW -d exp://10.0.2.2:8082`.
