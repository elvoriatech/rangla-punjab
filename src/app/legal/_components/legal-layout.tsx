import Link from "next/link";

/**
 * Wrapper around every legal page — the restaurant's own Impressum,
 * Datenschutz, AGB and Barrierefreiheit, plus Über uns. Zero JS.
 *
 * Every page gets a sticky list of the other pages and, when given, the
 * `lastUpdated` date ("Stand") in the footer. The "AI-drafted for counsel
 * review" banner is gone since the owner filled in and approved the texts
 * (2026-10-20).
 */

const LEGAL_ROUTES: { href: string; label: string }[] = [
  // Not a legal text, but the restaurant's own page lives in this list too
  // (owner, 2026-10-20) — the guest finds it beside the Impressum.
  { href: "/ueber-uns", label: "Über uns" },
  { href: "/legal/impressum", label: "Impressum" },
  { href: "/legal/privacy", label: "Datenschutz" },
  { href: "/legal/terms", label: "AGB" },
  { href: "/legal/accessibility", label: "Barrierefreiheit" },
];

export function LegalLayout({
  title,
  lastUpdated,
  currentPath,
  children,
}: {
  title: string;
  /** Omitted on a page built from live settings (Über uns). */
  lastUpdated?: string;
  currentPath: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <main
      lang="de"
      className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-8 bg-brand-cream px-6 py-16 text-brand-green md:grid-cols-[16rem_1fr]"
    >
      <nav aria-label="Rechtliches" className="md:sticky md:top-8 md:h-fit">
        <p className="mb-3 text-xs uppercase tracking-[0.28em] text-brand-gold">Rechtliches</p>
        <ul className="space-y-1 text-sm">
          {LEGAL_ROUTES.map((r) => (
            <li key={r.href}>
              {r.href === currentPath ? (
                <span
                  aria-current="page"
                  className="block border-l-2 border-brand-green px-3 py-1.5 font-medium"
                >
                  {r.label}
                </span>
              ) : (
                <Link
                  href={r.href}
                  className="block border-l-2 border-transparent px-3 py-1.5 text-brand-green/70 hover:border-brand-green/40 hover:text-brand-green"
                >
                  {r.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <article className="max-w-3xl">
        <h1 className="font-serif text-4xl leading-tight">{title}</h1>

        <div className="prose prose-neutral mt-8 max-w-none text-brand-green [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:mt-8 [&_h3]:mt-6 [&_p]:my-4">
          {children}
        </div>

        {lastUpdated ? (
          <footer className="mt-16 border-t border-brand-green/20 pt-6 text-xs text-brand-green/60">
            Stand: {lastUpdated}
          </footer>
        ) : null}
      </article>
    </main>
  );
}
