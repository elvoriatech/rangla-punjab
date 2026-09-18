import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { adminListTenants } from "@/lib/platform-admin";
import { platformHealth } from "@/lib/health";

/**
 * Operator dashboard — trade for the restaurant, plus whether the machine
 * is healthy. Nothing is editable here.
 *
 * This used to be a SaaS console: MRR, paying restaurants, trials ending,
 * lapsed tenants, recent registrations — every tile linking into
 * `/admin/restaurants`. One restaurant means MRR is a number the operator
 * already knows, "paying restaurants" is always 1, and there are no
 * registrations to watch. Those tiles and the sections behind them are
 * gone; what is left is the part that still says something: how the
 * restaurant traded, and whether anything is broken.
 */

export default async function AdminDashboardPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  // Still the gate, not a list: returns null for non-staff, which is what
  // turns this page into a 404 for everyone else.
  const tenants = await adminListTenants(userId);
  if (!tenants) notFound();

  const living = tenants.filter((t) => !t.deletedAt);
  const ordersToday = living.reduce((s, t) => s + t.ordersToday, 0);
  const volume30d = living.reduce((s, t) => s + t.revenue30dCents, 0);

  const euro = (cents: number): string =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const health = await platformHealth();
  const allHealthy = health.every((h) => h.ok);

  const stat = (label: string, value: string): React.ReactElement => (
    <div key={label} className="border border-white/10 bg-white/[0.03] px-5 py-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">{label}</p>
      <p className="mt-1 font-serif text-3xl text-white">{value}</p>
    </div>
  );

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="mx-auto max-w-6xl">
        <h1 className="font-serif text-3xl text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">Today&apos;s trade, and system health.</p>
      </header>

      <section
        aria-label="Key numbers"
        className="mx-auto mt-8 grid max-w-6xl grid-cols-2 gap-4 lg:grid-cols-2"
      >
        {stat("Orders today", String(ordersToday))}
        {stat("Order volume · 30d", euro(volume30d))}
      </section>

      <div className="mx-auto mt-10 max-w-6xl">
        <section aria-label="System health">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500">System health</h2>
            <span className={allHealthy ? "text-xs text-emerald-300" : "text-xs text-red-400"}>
              {allHealthy ? "All systems healthy" : "Attention needed"}
            </span>
          </div>
          <ul className="mt-3 divide-y divide-white/5 border border-white/10 bg-white/[0.02]">
            {health.map((h) => (
              <li key={h.name} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="text-sm text-white">
                  <span aria-hidden="true" className={h.ok ? "text-emerald-400" : "text-red-400"}>
                    {h.ok ? "✔" : "✖"}
                  </span>{" "}
                  {h.name}
                </span>
                <span className="truncate text-xs text-neutral-500">{h.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
