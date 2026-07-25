import Link from "next/link";

/**
 * Wrapper around every legal page. Fixed layout so guests reading Terms
 * on their phone see the same structure they'd see reading it on
 * desktop, and so counsel review is easier (one visual pass covers all
 * five pages). Zero JS.
 *
 * Every page gets:
 *   - a "placeholder copy, not legally binding" banner at the top
 *   - a sticky ToC sidebar with the other legal pages
 *   - the `lastUpdated` date in the footer
 */

const LEGAL_ROUTES: { href: string; label: string }[] = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/dpa", label: "Data Processing Agreement" },
  { href: "/legal/impressum", label: "Impressum" },
  { href: "/legal/accessibility", label: "Accessibility Statement" },
];

export function LegalLayout({
  title,
  lastUpdated,
  currentPath,
  children,
}: {
  title: string;
  lastUpdated: string;
  currentPath: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <main className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-8 bg-brand-cream px-6 py-16 text-brand-green md:grid-cols-[16rem_1fr]">
      <nav aria-label="Legal pages" className="md:sticky md:top-8 md:h-fit">
        <p className="mb-3 text-xs uppercase tracking-[0.28em] text-brand-gold">Legal</p>
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
        <aside
          role="note"
          className="mb-8 border-l-4 border-amber-500 bg-amber-100 p-4 text-sm text-amber-900"
        >
          <strong className="block font-semibold">TODO: legal review</strong>
          This page has been <strong>AI-drafted for counsel review</strong> — it is a working draft,
          not legally binding. Counsel edits the file in place and removes this banner (task
          P1-22c-ii) before we invite the first paying tenant.
        </aside>

        <h1 className="font-serif text-4xl leading-tight">{title}</h1>

        <div className="prose prose-neutral mt-8 max-w-none text-brand-green [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:mt-8 [&_h3]:mt-6 [&_p]:my-4">
          {children}
        </div>

        <footer className="mt-16 border-t border-brand-green/20 pt-6 text-xs text-brand-green/60">
          Last updated: {lastUpdated}
        </footer>
      </article>
    </main>
  );
}
