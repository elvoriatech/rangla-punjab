import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUserId } from "@/lib/auth";
import { adminListAuditEvents } from "@/lib/platform-admin";

/**
 * Audit trail — every platform-admin action against a tenant (plan
 * overrides land as admin.plan_changed once actions write them,
 * suspend/restore/delete already do). Read-only, newest first; the
 * deeper API/system logs live in external tooling, deliberately.
 */

export default async function AdminAuditPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const events = await adminListAuditEvents(userId, 200);
  if (!events) notFound();

  const fmt = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Berlin",
  });

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="mx-auto max-w-5xl">
        <h1 className="font-serif text-3xl text-white">Audit trail</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Platform actions against tenants — who did what, to whom, when. Last 200 events.
        </p>
      </header>

      <section aria-label="Events" className="mx-auto mt-8 max-w-5xl overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              <th className="py-3 pr-4 font-medium">When</th>
              <th className="py-3 pr-4 font-medium">Actor</th>
              <th className="py-3 pr-4 font-medium">Action</th>
              <th className="py-3 font-medium">Restaurant</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-white/5">
                <td className="py-3 pr-4 tabular-nums text-neutral-400">{fmt.format(e.at)}</td>
                <td className="py-3 pr-4 text-neutral-300">{e.actor ?? "system"}</td>
                <td className="py-3 pr-4">
                  <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-admin-accent">
                    {e.kind}
                  </code>
                </td>
                <td className="py-3">
                  <Link
                    href={`/admin/restaurants/${e.tenantId}`}
                    className="text-white underline-offset-2 hover:underline"
                  >
                    {e.tenantName ?? e.tenantId}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            No audit events yet — they appear as soon as an admin action runs.
          </p>
        ) : null}
      </section>
    </main>
  );
}
