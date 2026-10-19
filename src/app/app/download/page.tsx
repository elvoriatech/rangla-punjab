import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppStoreBadge, GooglePlayBadge } from "../../(public)/app-badges";
import { APP_DOWNLOAD_PATH, detectPlatform, type AppPlatform } from "@/lib/app-download";
import { renderQrSvg } from "@/lib/qr";
import { siteUrl } from "@/lib/site-url";
import { getRestaurantAppLinks, getRestaurantIdentity } from "@/lib/restaurant";

/**
 * `/app/download` — where the "get the app" QR lands when it cannot send
 * the phone straight to a store (see `lib/app-download.ts`): a store that
 * is still coming soon, or a desktop browser.
 *
 * Never a dead end: whatever the app's state, the biggest thing on the
 * page is "order online now", because the web menu takes orders today.
 * Server-rendered, no cookies, no script — it has to work from a brochure
 * on any phone.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "App",
  robots: { index: false, follow: true },
};

const COPY = {
  de: {
    title: "Unsere App",
    soonIos: "Die App für iPhone und iPad kommt bald.",
    soonAndroid: "Die App für Android kommt bald.",
    soonBoth: "Bald im App Store und bei Google Play.",
    choose: "Jetzt verfügbar:",
    meanwhile: "Bis dahin bestellen Sie ganz einfach online — gleiche Speisekarte, gleiche Punkte.",
    orderNow: "Jetzt online bestellen",
    iosTop: "Laden im",
    androidTop: "Jetzt bei",
    soonPlay: "Die Android-App kommt bald zu Google Play.",
    apkLead:
      "Bis dahin können Sie unsere offizielle Release-Version direkt bei uns herunterladen — nicht über Google Play, sondern als Installationsdatei (APK) von unserer Release-Seite.",
    apkButton: "Offizielle Android-App herunterladen (APK)",
    apkSteps: [
      "Tippen Sie auf den Button — die Datei wird heruntergeladen.",
      "Öffnen Sie die Datei und tippen Sie auf „Installieren“.",
      "Fragt Android nach „Unbekannte Apps“, erlauben Sie es für Ihren Browser.",
    ],
    apkOr: "Oder bestellen Sie direkt online:",
    scan: "Mit dem Handy scannen, um die App zu laden",
    apkDesktop: "Android-App direkt herunterladen (APK)",
  },
  en: {
    title: "Our app",
    soonIos: "The app for iPhone and iPad is coming soon.",
    soonAndroid: "The app for Android is coming soon.",
    soonBoth: "Coming soon to the App Store and Google Play.",
    choose: "Available now:",
    meanwhile: "Until then, simply order online — same menu, same points.",
    orderNow: "Order online now",
    iosTop: "Download on the",
    androidTop: "Get it on",
    soonPlay: "The Android app is coming to Google Play soon.",
    apkLead:
      "Until then, you can download our official release version directly from us — not through Google Play, but as an install file (APK) from our release page.",
    apkButton: "Download the official Android app (APK)",
    apkSteps: [
      "Tap the button — the file downloads.",
      "Open the file and tap “Install”.",
      "If Android asks about “unknown apps”, allow it for your browser.",
    ],
    apkOr: "Or order online right away:",
    scan: "Scan with your phone to get the app",
    apkDesktop: "Download the Android app directly (APK)",
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];

function soonLine(
  platform: AppPlatform,
  hasIos: boolean,
  hasAndroid: boolean,
  t: Copy,
): string | null {
  if (platform === "ios" && !hasIos) return t.soonIos;
  if (platform === "android" && !hasAndroid) return t.soonAndroid;
  if (!hasIos && !hasAndroid) return t.soonBoth;
  return null;
}

export default async function AppDownloadPage(): Promise<React.ReactElement> {
  const h = await headers();
  const t = /^en\b/i.test(h.get("accept-language") ?? "") ? COPY.en : COPY.de;
  const platform = detectPlatform(h.get("user-agent"));
  const [links, identity] = await Promise.all([getRestaurantAppLinks(), getRestaurantIdentity()]);
  const hasAnyStore = links.ios !== null || links.android !== null;
  // Before the Play listing is public, an Android phone gets the venue's
  // own signed build — as a button the guest chooses to tap, with the three
  // install steps beside it, never a download that starts on its own.
  const apk = platform === "android" && links.android === null ? links.apk : null;
  const soon = apk ? t.soonPlay : soonLine(platform, links.ios !== null, links.android !== null, t);
  // On a computer there is no app to install here: a QR code takes the
  // guest's phone to `/app`, which picks the right store for it, and the
  // Android download is offered as a plain link too (owner, 2026-10-19).
  const desktop = platform === "other";
  const qrSvg = desktop ? await renderQrSvg(`${siteUrl()}${APP_DOWNLOAD_PATH}`) : null;
  const desktopApk = desktop && links.android === null ? links.apk : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 py-12 text-center text-ink">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/rangla-logo.png"
        alt={identity?.name ?? ""}
        width={160}
        height={160}
        className="h-40 w-40 rounded-3xl object-contain shadow-sm"
      />
      <h1 className="mt-6 font-serif text-4xl leading-tight">{t.title}</h1>
      {soon ? <p className="mt-3 max-w-sm text-lg">{soon}</p> : null}

      {hasAnyStore ? (
        <section aria-label={t.choose} className="mt-6">
          <p className="text-sm text-muted">{t.choose}</p>
          <ul className="mt-3 flex flex-wrap items-center justify-center gap-3">
            {links.ios ? (
              <li>
                <a href={links.ios} aria-label={`${t.iosTop} App Store`} className="inline-flex">
                  <AppStoreBadge
                    topLine={t.iosTop}
                    storeName="App Store"
                    className="h-[54px] w-[182px]"
                  />
                </a>
              </li>
            ) : null}
            {links.android ? (
              <li>
                <a
                  href={links.android}
                  aria-label={`${t.androidTop} Google Play`}
                  className="inline-flex"
                >
                  <GooglePlayBadge
                    topLine={t.androidTop}
                    storeName="Google Play"
                    className="h-[54px] w-[182px]"
                  />
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {qrSvg ? (
        <figure className="mt-6 flex flex-col items-center">
          <div
            role="img"
            aria-label={t.scan}
            className="h-44 w-44 rounded-xl bg-white p-2 shadow-sm [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <figcaption className="mt-2 text-sm text-muted">{t.scan}</figcaption>
        </figure>
      ) : null}

      {desktopApk ? (
        <a href={desktopApk} download className="mt-4 text-sm font-semibold text-ink underline">
          {t.apkDesktop}
        </a>
      ) : null}

      {apk ? (
        <section aria-label={t.apkButton} className="mt-6 flex max-w-sm flex-col items-center">
          <p className="text-base">{t.apkLead}</p>
          <a
            href={apk}
            download
            className="mt-4 inline-flex min-h-12 items-center rounded-full bg-ink px-8 text-base font-semibold text-cream no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {t.apkButton}
          </a>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-left text-sm text-muted">
            {t.apkSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {apk ? (
        <p className="mt-8 max-w-sm text-sm text-muted">{t.apkOr}</p>
      ) : soon ? (
        <p className="mt-6 max-w-sm text-sm text-muted">{t.meanwhile}</p>
      ) : null}
      <Link
        href="/"
        className="mt-6 inline-flex min-h-12 items-center rounded-full bg-orange px-8 text-base font-semibold text-white no-underline transition-colors hover:bg-orange-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
      >
        {t.orderNow}
      </Link>
    </main>
  );
}
