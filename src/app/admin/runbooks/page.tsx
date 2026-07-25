import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { resolveAdminRunbooksPage } from "@/lib/admin-runbooks-page";

/**
 * `/admin/runbooks` (P3-3). Operator-only. Renders the SLO catalogue on
 * the left, each runbook on the right, verbatim text so the operator sees
 * exactly what's in-tree at 3am. Server component, zero client JS.
 */

export default async function AdminRunbooksPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const result = await resolveAdminRunbooksPage(userId);
  if (!result.ok) {
    if (result.error === "unauthenticated") redirect("/login");
    // `notFound()` renders the 404 page, which is our forbidden shape
    // for dashboard routes — we do not want to advertise the existence
    // of the admin surface to non-owners.
    notFound();
  }
  const { slos, runbooks } = result;

  return (
    <main className="min-h-screen bg-admin-bg px-6 py-10 text-neutral-200 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs uppercase tracking-[0.28em] text-admin-accent">Admin</p>
        <h1 className="mt-1 font-serif text-3xl leading-tight text-white">Runbooks</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Service-level objectives from <code className="text-neutral-300">src/lib/slo.ts</code> and
          the on-call runbooks from{" "}
          <code className="text-neutral-300">src/content/runbooks/*.mdx</code>. Both are
          source-of-truth for the alerts we page on.
        </p>

        <section aria-labelledby="slos-heading" className="mt-10">
          <h2 id="slos-heading" className="font-serif text-2xl text-white">
            Service-level objectives
          </h2>
          <ul className="mt-4 divide-y divide-white/10 border-y border-white/10">
            {slos.map((slo) => (
              <li key={slo.id} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-semibold text-white">{slo.name}</h3>
                  <span className="text-sm tabular-nums text-admin-accent/90">
                    {slo.comparison === "lte" ? "≤" : "≥"} {formatTarget(slo.target, slo.unit)} over{" "}
                    {slo.windowDays} d
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-400">{slo.description}</p>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-neutral-500">
                  metrics: {slo.metrics.join(", ")} · alerts:{" "}
                  {slo.burnAlerts
                    .map((a) => `${a.severity} @ ${a.budgetFraction * 100}% / ${a.windowMinutes}m`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="runbooks-heading" className="mt-12">
          <h2 id="runbooks-heading" className="font-serif text-2xl text-white">
            Runbooks
          </h2>
          <div className="mt-4 space-y-8">
            {runbooks.map((rb) => (
              <article
                key={rb.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <h3 className="font-serif text-xl text-white">{rb.title}</h3>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-neutral-500">
                  {rb.name}
                </p>
                <div className="mt-4 space-y-4">
                  {rb.sections.map((s) => (
                    <div key={s.heading}>
                      <h4 className="text-sm font-semibold uppercase tracking-widest text-admin-accent/80">
                        {s.heading}
                      </h4>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-neutral-300">
                        {s.body}
                      </pre>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function formatTarget(value: number, unit: "ms" | "ratio"): string {
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}
