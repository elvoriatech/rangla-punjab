import Link from "next/link";

/** Where a team member lands on an area the owner hasn't ticked for them. */
export default function NoAccessPage(): React.ReactElement {
  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-16 text-ink">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Team access</p>
      <h1 className="font-serif text-4xl leading-tight">Not available for your login</h1>
      <p className="mt-3 text-sm text-muted">
        The owner hasn&apos;t given your login access to this area. Ask them to tick it on the Team
        page if you need it.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block bg-orange px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-card hover:bg-orange-dark"
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
