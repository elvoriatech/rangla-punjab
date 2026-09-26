import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { siteUrl } from "@/lib/public-menu";
import { getVenueAppLinks } from "@/lib/venue-service";
import { APP_DOWNLOAD_PATH } from "@/lib/app-download";

/**
 * QR codes page — the physical half of the product. One big scannable
 * preview, two download buttons, and plain guidance on where each format
 * belongs. Black-on-white only: contrast is what scans.
 */

export default async function QrPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");
  const venue = venueResult.value;
  const publicUrl = `${siteUrl()}/`;
  const appUrl = `${siteUrl()}${APP_DOWNLOAD_PATH}`;
  const linksResult = await getVenueAppLinks(userId);
  const links = linksResult.ok ? linksResult.value : { ios: null, android: null, apk: null };

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12 text-ink lg:px-10">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">QR codes</p>
      <h1 className="font-serif text-4xl leading-tight">Put your menu on the table</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Every code below opens <span className="text-ink">{publicUrl}</span>. Print it once — the
        code never changes, even when you update the menu.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <section
          aria-label="QR preview"
          className="flex flex-col items-center border border-ink/15 bg-card p-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/api/qr?format=png"
            alt={`QR code linking to ${publicUrl}`}
            width={240}
            height={240}
            className="h-60 w-60"
          />
          <p className="mt-4 text-center text-[11px] uppercase tracking-[0.22em] text-muted">
            Scan me — {venue.name}
          </p>
        </section>

        <section aria-label="Downloads" className="space-y-4">
          <DownloadCard
            href="/api/qr?format=png&download=1"
            title="Download PNG"
            body="For table tents, stickers, and anything printed in-house. 200 px, crisp at 300 DPI."
          />
          <DownloadCard
            href="/api/qr?format=svg&download=1"
            title="Download SVG"
            body="For designers and print shops. Scales to a shop window without a single blurry pixel."
          />
          <div className="border border-ink/15 bg-card px-5 py-4">
            <p className="font-serif text-xl">Printing tips</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
              <li>Keep the code at least 3 × 3 cm — smaller struggles in dim light.</li>
              <li>Leave the white border in place; it&apos;s part of what makes it scan.</li>
              <li>Laminate table tents — the code survives spills, and so does your evening.</li>
            </ul>
          </div>
        </section>
      </div>

      {/* The "get the app" code: one code for every phone. It encodes a
          link that never changes, so a brochure printed while a store is
          still "coming soon" starts sending phones there the day the
          store link is saved in Settings. */}
      <h2 id="app-qr" className="mt-16 font-serif text-3xl leading-tight">
        App download code
      </h2>
      <p className="mt-2 max-w-xl text-sm text-muted">
        One code for brochures and flyers. It opens <span className="text-ink">{appUrl}</span>,
        which sends iPhones to the App Store and Android phones to Google Play. Until a store link
        is saved, that phone sees “coming soon” with a button to order online — so you can print it
        today.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <section
          aria-label="App QR preview"
          className="flex flex-col items-center border border-ink/15 bg-card p-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/api/qr?target=app&format=png"
            alt={`QR code linking to ${appUrl}`}
            width={240}
            height={240}
            className="h-60 w-60"
          />
          <p className="mt-4 text-center text-[11px] uppercase tracking-[0.22em] text-muted">
            Scan to get the app
          </p>
        </section>

        <section aria-label="App QR downloads" className="space-y-4">
          <div className="border border-ink/15 bg-card px-5 py-4">
            <p className="font-serif text-xl">Where a scan goes right now</p>
            <ul className="mt-3 space-y-2 text-sm">
              <StoreStatus platform="iPhone / iPad" url={links.ios} store="App Store" />
              <StoreStatus
                platform="Android"
                url={links.android}
                store="Google Play"
                fallback={links.apk ? "→ page with the direct APK download" : undefined}
              />
            </ul>
            <Link
              href="/dashboard/settings#app-links"
              className="mt-3 inline-block text-sm text-orange-dark underline underline-offset-2"
            >
              Change store links in Settings
            </Link>
          </div>
          <DownloadCard
            href="/api/qr?target=app&format=png&download=1"
            title="Download PNG"
            body="For flyers and brochures printed in-house."
          />
          <DownloadCard
            href="/api/qr?target=app&format=svg&download=1"
            title="Download SVG"
            body="For the print shop — sharp at any size."
          />
        </section>
      </div>
    </main>
  );
}

/** One line of "where does a scan go": the store when its link is saved,
 *  otherwise the coming-soon page. */
function StoreStatus({
  platform,
  url,
  store,
  fallback,
}: {
  platform: string;
  url: string | null;
  store: string;
  /** What a scan shows when there is no store link (default: coming soon). */
  fallback?: string;
}): React.ReactElement {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="font-medium">{platform}</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener" className="text-orange-dark underline">
          → {store}
        </a>
      ) : (
        <span className="text-muted">{fallback ?? "→ “Coming soon” + order online"}</span>
      )}
    </li>
  );
}

function DownloadCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <a
      href={href}
      className="group block border border-ink/15 bg-card px-5 py-4 transition-colors hover:border-orange/50"
    >
      <p className="font-serif text-xl group-hover:text-orange-dark">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </a>
  );
}
