import Link from "next/link";
import type { Metadata } from "next";

/**
 * `/beta` — the one link (and one QR) we hand out for the Android closed
 * test on Google Play. Play needs two hops — join the tester Google Group,
 * then opt in — so this page puts both behind a single short URL on our
 * own domain. English first, German beneath, because the testers are
 * both local guests and family abroad.
 *
 * Static, no cookies, no script: it opens from a printed card on any phone.
 * If the group or the Play package ever changes, only the two constants
 * below change — the printed QR keeps working.
 */

const GROUP_URL = "https://groups.google.com/g/rangla-beta";
const OPT_IN_URL = "https://play.google.com/apps/testing/de.ranglapunjabrestaurant.app";

export const metadata: Metadata = {
  title: "Android beta",
  description: "Test the Rangla Punjab app for Android before everyone else.",
  robots: { index: false, follow: false },
};

const STEPS = [
  {
    href: GROUP_URL,
    en: "Join the tester group",
    de: "Der Testgruppe beitreten",
    hintEn: "Tap “Join group”, then come back to this page.",
    hintDe: "Auf „Gruppe beitreten“ tippen, dann zu dieser Seite zurückkehren.",
  },
  {
    href: OPT_IN_URL,
    en: "Become a tester & install",
    de: "Tester werden & installieren",
    hintEn: "Tap “Become a tester”, then “Download it on Google Play”.",
    hintDe: "„Tester werden“ tippen, dann „Bei Google Play herunterladen“.",
  },
] as const;

const buttonClass =
  "flex min-h-14 w-full flex-col items-center justify-center rounded-2xl bg-orange px-6 py-3 text-white no-underline transition-colors hover:bg-orange-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange";

export default function BetaPage(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center bg-cream px-4 py-10 text-center text-ink sm:py-14">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/rangla-logo.png"
        alt="Rangla Punjab Restaurant"
        width={112}
        height={112}
        className="h-28 w-28 rounded-3xl object-contain shadow-sm"
      />
      <h1 className="mt-5 font-serif text-4xl leading-tight">Try our new app first!</h1>
      <p lang="de" className="mt-1 font-serif text-2xl leading-tight text-muted">
        Testen Sie unsere neue App zuerst!
      </p>
      <p className="mt-4 max-w-sm text-base">
        Android beta · two quick taps
        <br />
        <span lang="de" className="text-muted">
          Android-Beta · zwei kurze Schritte
        </span>
      </p>

      <ol className="mt-8 w-full max-w-sm space-y-6">
        {STEPS.map((step, i) => (
          <li key={step.href} className="flex flex-col items-center">
            <span
              aria-hidden="true"
              className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-base font-bold text-cream"
            >
              {i + 1}
            </span>
            <a href={step.href} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              <span className="text-lg font-semibold">
                <span className="sr-only">Step {i + 1}: </span>
                {step.en}
              </span>
              <span lang="de" className="text-sm opacity-90">
                {step.de}
              </span>
            </a>
            <p className="mt-2 text-sm">{step.hintEn}</p>
            <p lang="de" className="text-sm text-muted">
              {step.hintDe}
            </p>
          </li>
        ))}
      </ol>

      <section className="mt-8 w-full max-w-sm rounded-2xl bg-white/70 px-5 py-4 text-sm leading-relaxed">
        <p>
          <strong>Please keep the app for 14 days</strong> and open it now and then — browse the
          menu, collect points. That helps us launch it for everyone.
        </p>
        <p lang="de" className="mt-2 text-muted">
          <strong>Bitte behalten Sie die App 14 Tage</strong> und öffnen Sie sie ab und zu —
          Speisekarte ansehen, Punkte sammeln. So helfen Sie uns beim Start für alle.
        </p>
      </section>

      <p className="mt-6 max-w-sm text-sm text-muted">
        “App not available” in step 2? Make sure you finished step 1 with the same Google account
        your Play Store uses, then wait a few minutes and try again.
      </p>
      <p lang="de" className="mt-1 max-w-sm text-sm text-muted">
        „App nicht verfügbar“ bei Schritt 2? Schritt 1 mit demselben Google-Konto abschließen, das
        im Play Store angemeldet ist, dann ein paar Minuten warten.
      </p>

      <Link
        href="/"
        className="mt-8 text-base font-semibold text-ink underline underline-offset-4 hover:text-orange"
      >
        Back to the menu · Zur Speisekarte
      </Link>
    </main>
  );
}
