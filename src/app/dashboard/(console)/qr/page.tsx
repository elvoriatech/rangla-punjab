import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { siteUrl } from "@/lib/public-menu";

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
    </main>
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
