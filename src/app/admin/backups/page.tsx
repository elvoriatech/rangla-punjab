import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { resolveAdminBackupsPage } from "@/lib/admin-backups-page";

/**
 * `/admin/backups` (P3-3). Operator-only. Read-only surface — lists the
 * retention tiers the app-side policy declares. The actual snapshots live
 * on the managed Postgres and are managed there; this page
 * exists so an operator can confirm at a glance what the policy is
 * *supposed* to be, and so a compliance auditor has a stable URL.
 */

export default async function AdminBackupsPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const result = await resolveAdminBackupsPage(userId);
  if (!result.ok) {
    if (result.error === "unauthenticated") redirect("/login");
    // 404 rather than 403 — same rationale as the runbooks page:
    // don't advertise the admin surface's existence to non-owners.
    notFound();
  }

  return (
    <main className="min-h-screen bg-admin-bg px-6 py-10 text-neutral-200 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs uppercase tracking-[0.28em] text-admin-accent">Admin</p>
        <h1 className="mt-1 font-serif text-3xl leading-tight text-white">Backups</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Retention policy for the managed Postgres cluster. Snapshots themselves live in IONOS
          Managed PG; this page is the app-side source of truth for what the retention is
          <em> supposed </em> to be.
        </p>

        <div className="mt-10 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.02]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-widest text-neutral-500">
                <th className="px-5 py-3">Tier</th>
                <th className="px-5 py-3">Retention</th>
                <th className="px-5 py-3">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {result.rows.map((row) => (
                <tr key={row.tier} className="align-top">
                  <td className="px-5 py-4 font-semibold text-white">{row.label}</td>
                  <td className="px-5 py-4 tabular-nums text-admin-accent/90">
                    {row.retentionValue} {row.retentionUnit}
                  </td>
                  <td className="px-5 py-4 text-neutral-400">{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-10 text-xs text-neutral-500">
          This page is read-only. Changes to the retention policy require a code edit to{" "}
          <code className="text-neutral-400">src/lib/backup-policy.ts</code> and the corresponding
          IONOS console setting.
        </p>
      </div>
    </main>
  );
}
