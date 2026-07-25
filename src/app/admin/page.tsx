import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUserId } from "@/lib/auth";
import { accessForRow, adminListTenants } from "@/lib/platform-admin";
import { platformHealth } from "@/lib/health";
import { PLANS } from "@/lib/plans";
import { PLAN_LABELS } from "@/lib/plan-state";

/**
 * Platform dashboard — the landing snapshot: money, momentum, and
 * whether the machine is healthy. Everything links into the deeper
 * sections; nothing is editable here.
 */

export default async function AdminDashboardPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenants = await adminListTenants(userId);
  if (!tenants) notFound();

  const living = tenants.filter((t) => !t.deletedAt);
  const withAccess = living.map((t) => ({ t, access: accessForRow(t) }));
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const active = withAccess.filter((a) => a.access.state === "active");
  const trials = withAccess.filter((a) => a.access.state === "trial");
  const endingSoon = trials.filter((a) => (a.access.trialDaysLeft ?? 99) <= 7);
  const lapsed = withAccess.filter(
    (a) => a.access.state === "lapsed_grace" || a.access.state === "lapsed_off",
  );
  const newThisMonth = living.filter((t) => t.createdAt >= monthStart);
  // MRR counts paying subscriptions only — trials and admin overrides
  // are access, not revenue.
  const mrrCents = active.reduce(
    (sum, a) => sum + (a.access.plan ? PLANS[a.access.plan].priceMonthlyCents : 0),
    0,
  );
  const ordersToday = living.reduce((s, t) => s + t.ordersToday, 0);
  const volume30d = living.reduce((s, t) => s + t.revenue30dCents, 0);

  const euro = (cents: number): string =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const health = await platformHealth();
  const allHealthy = health.every((h) => h.ok);
  const recent = living.slice(0, 5);

  const stat = (label: string, value: string, href: string, tone?: "warn"): React.ReactElement => (
    <Link
      key={label}
      href={href}
      className={`border px-5 py-4 transition-colors hover:border-admin-accent/40 ${
        tone === "warn" ? "border-red-500/30 bg-red-500/5" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">{label}</p>
      <p className="mt-1 font-serif text-3xl text-white">{value}</p>
    </Link>
  );

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="mx-auto max-w-6xl">
        <h1 className="font-serif text-3xl text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-400">
          The platform at a glance — money, momentum, health.
        </p>
      </header>

      <section
        aria-label="Key numbers"
        className="mx-auto mt-8 grid max-w-6xl grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {stat("MRR", euro(mrrCents), "/admin/restaurants")}
        {stat("Paying restaurants", String(active.length), "/admin/restaurants")}
        {stat("In trial", String(trials.length), "/admin/restaurants")}
        {stat("New this month", String(newThisMonth.length), "/admin/restaurants")}
        {stat(
          "Trials ending ≤ 7d",
          String(endingSoon.length),
          "/admin/restaurants?filter=ending",
          endingSoon.length > 0 ? "warn" : undefined,
        )}
        {stat(
          "Lapsed",
          String(lapsed.length),
          "/admin/restaurants?filter=lapsed",
          lapsed.length > 0 ? "warn" : undefined,
        )}
        {stat("Orders today", String(ordersToday), "/admin/restaurants")}
        {stat("Order volume · 30d", euro(volume30d), "/admin/restaurants")}
      </section>

      <div className="mx-auto mt-10 grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Recent registrations">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500">
              Recent registrations
            </h2>
            <Link
              href="/admin/restaurants"
              className="text-xs text-admin-accent/90 underline-offset-2 hover:underline"
            >
              View all
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-white/5 border border-white/10 bg-white/[0.02]">
            {recent.map(({ id, name, venueName, createdAt }) => {
              const a = withAccess.find((x) => x.t.id === id)!;
              return (
                <li key={id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <Link
                    href={`/admin/restaurants/${id}`}
                    className="truncate text-sm text-white underline-offset-2 hover:underline"
                  >
                    {venueName ?? name}
                  </Link>
                  <span className="flex shrink-0 items-baseline gap-3 text-xs text-neutral-500">
                    <span
                      className={
                        a.access.state === "trial"
                          ? "text-sky-300"
                          : a.access.state === "active"
                            ? "text-emerald-300"
                            : "text-neutral-400"
                      }
                    >
                      {a.access.state === "trial"
                        ? `Trial · ${a.access.trialDaysLeft}d`
                        : a.access.state === "active"
                          ? `Active · ${a.access.plan ? PLAN_LABELS[a.access.plan] : ""}`
                          : a.access.state}
                    </span>
                    <span className="tabular-nums">
                      {new Intl.DateTimeFormat("de-DE", { dateStyle: "short" }).format(createdAt)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

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
