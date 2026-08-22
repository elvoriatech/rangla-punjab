import { BRAND } from "@/lib/brand";
import { FlashMessage } from "@/components/flash-message";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUserId } from "@/lib/auth";
import { accessForRow, adminListTenants } from "@/lib/platform-admin";
import { asTenant } from "@/lib/tenant";
import { siteUrl } from "@/lib/public-menu";
import { PurgeTenantButton } from "./purge-button";
import {
  impersonateAction,
  setDeletedAction,
  setStatusAction,
  transferOwnershipAction,
} from "../../actions";
import { resendOwnerInviteAction } from "../actions";
import { adminImportMenuAction } from "../menu-io-actions";
import { SequentialImageUploader } from "../../sequential-image-uploader";
import { SubmitButton } from "@/components/submit-button";

/**
 * One restaurant, in full: identity, activity, owner + support tools, and
 * the danger zone (suspend / soft-delete / purge). Detail reads run under
 * the tenant's own RLS context via asTenant — the platform-admin gate is
 * the layout's; this page only ever reads.
 */

export default async function AdminRestaurantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    confirmDelete?: string;
    menu?: string;
    img?: string;
    c?: string;
    i?: string;
    m?: string;
    w?: string;
    n?: string;
    s?: string;
    r?: string;
    f?: string;
  }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenants = await adminListTenants(userId);
  if (!tenants) notFound();

  const { id } = await params;
  const t = tenants.find((row) => row.id === decodeURIComponent(id));
  if (!t) notFound();
  const access = accessForRow(t);
  const sp = await searchParams;
  const { saved, error, confirmDelete } = sp;
  const menuNotice =
    sp.menu === "ok"
      ? `Menu imported — ${sp.c ?? 0} categories, ${sp.i ?? 0} items.` +
        (Number(sp.m) > 0 ? ` ${sp.m} image name(s) not found.` : "") +
        (Number(sp.w) > 0 ? ` ${sp.w} row(s) skipped.` : "") +
        " The owner reviews and publishes."
      : sp.menu === "err"
        ? `Import failed — couldn't read the file (${sp.n ?? 0} problem(s)).`
        : sp.menu === "nofile"
          ? "No file was selected."
          : sp.menu === "nodraft"
            ? "This restaurant has no menu to import into yet."
            : null;
  const menuError = sp.menu === "err" || sp.menu === "nofile" || sp.menu === "nodraft";

  // Menu size + storage, read under the tenant's own RLS context.
  const detail = await asTenant(t.id, async (tx) => {
    const [items, categories, media, scanDays, orderDays] = await Promise.all([
      tx.item.count({ where: { deletedAt: null } }),
      tx.category.count(),
      tx.media.aggregate({ _sum: { bytes: true }, _count: true }),
      tx.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', at AT TIME ZONE 'Europe/Berlin') AS day, count(*) AS n
        FROM scan_stats WHERE at >= now() - interval '14 days'
        GROUP BY 1 ORDER BY 1`,
      tx.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Europe/Berlin') AS day, count(*) AS n
        FROM orders WHERE "createdAt" >= now() - interval '14 days'
        GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      items,
      categories,
      mediaCount: media._count,
      mediaBytes: media._sum.bytes ?? 0,
      scanDays: scanDays.map((r) => ({ day: r.day, n: Number(r.n) })),
      orderDays: orderDays.map((r) => ({ day: r.day, n: Number(r.n) })),
    };
  });

  const euro = (cents: number): string =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const date = (d: Date | null): string =>
    d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(d) : "—";
  const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const stateLabel =
    access.state === "suspended"
      ? `Suspended by ${BRAND.name}`
      : access.state === "deleted"
        ? "Deleted — restorable"
        : "Active";

  const FACTS: [string, React.ReactNode][] = [
    ["Owner email", t.ownerEmail ?? "no owner on file"],
    ["Email verified", t.ownerVerified ? "yes" : "not yet"],
    ["Registered", date(t.createdAt)],
    ["Menu published", t.hasPublished ? "yes" : "not yet"],
    ["Menu size", `${detail.categories} categories · ${detail.items} dishes`],
    ["Uploads", `${detail.mediaCount} files · ${mb(detail.mediaBytes)}`],
    ["QR scans · 30d", String(t.scans30d)],
    ["Orders · today / 30d", `${t.ordersToday} / ${t.orders30d}`],
    ["Order volume · 30d", euro(t.revenue30dCents)],
    ["Support subscription", t.subStatus ? `${t.subStatus}` : "not set up (billed out of band)"],
  ];

  return (
    <main className="px-6 py-10 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/admin/restaurants"
          className="text-xs text-neutral-500 underline-offset-2 hover:text-white hover:underline"
        >
          ← All restaurants
        </Link>
        <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl text-white">{t.venueName ?? t.name}</h1>
            <p
              className={
                access.state === "suspended" || access.state === "deleted"
                  ? "mt-1 text-sm text-red-400"
                  : "mt-1 text-sm text-emerald-300"
              }
            >
              {stateLabel}
            </p>
          </div>
          {t.venueSlug ? (
            <a
              href={`${siteUrl()}/`}
              target="_blank"
              rel="noreferrer"
              className="border border-white/15 px-3 py-2 text-xs text-admin-accent/90 hover:border-admin-accent/50"
            >
              Open public menu ↗
            </a>
          ) : null}
        </header>

        {saved ? (
          <FlashMessage
            kind="success"
            text={saved === "invited" ? "Invite email sent to the owner." : "Saved."}
          />
        ) : null}
        {error ? (
          <FlashMessage
            kind="error"
            text={
              error === "no_such_user"
                ? "No account exists with that email — the new owner must sign up first."
                : "That didn't work — try again."
            }
          />
        ) : null}
        {menuNotice ? (
          <FlashMessage kind={menuError ? "error" : "success"} text={menuNotice} />
        ) : null}

        <section aria-label="Overview" className="mt-8 border border-white/10 bg-white/[0.02]">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {FACTS.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 border-b border-white/5 px-5 py-3"
              >
                <dt className="text-xs uppercase tracking-[0.14em] text-neutral-500">{label}</dt>
                <dd className="text-right text-sm text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-label="Last 14 days" className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <DayBars title="QR scans · 14d" days={detail.scanDays} color="#7dd3fc" />
          <DayBars title="Orders · 14d" days={detail.orderDays} color="#fbbf24" />
        </section>

        <section aria-label="Support tools" className="mt-8 flex flex-wrap items-center gap-4">
          {t.ownerEmail ? (
            <form action={resendOwnerInviteAction}>
              <input type="hidden" name="ownerEmail" value={t.ownerEmail} />
              <button
                type="submit"
                title="Email the owner a link to set their password"
                className="border border-admin-accent/40 px-3 py-2 text-xs uppercase tracking-wider text-admin-accent hover:bg-admin-accent/10"
              >
                ✉ Resend invite
              </button>
            </form>
          ) : null}
          <form action={impersonateAction}>
            <input type="hidden" name="tenantId" value={t.id} />
            <button
              type="submit"
              className="border border-violet-400/50 px-3 py-2 text-xs uppercase tracking-wider text-violet-300 hover:bg-violet-400/10"
              title="Opens the owner's dashboard in a 30-minute audited support session"
            >
              👁 Log in as owner
            </button>
          </form>
          <form action={transferOwnershipAction} className="flex items-center gap-2">
            <input type="hidden" name="tenantId" value={t.id} />
            <input
              type="email"
              name="email"
              required
              placeholder="new-owner@example.com"
              className="w-60 border border-white/15 bg-admin-surface px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60"
            />
            <button
              type="submit"
              className="border border-white/20 px-3 py-2 text-xs uppercase tracking-wider text-neutral-300 hover:border-admin-accent/50 hover:text-white"
            >
              Transfer ownership
            </button>
          </form>
        </section>

        <section aria-label="Bulk menu" className="mt-8 border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white">Menu — bulk import / export</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Operator tool. The owner edits dishes one-by-one in their dashboard; here you can
            round-trip the whole menu through a spreadsheet and upload photos in bulk. Imports land
            in the draft — the owner reviews and publishes.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {/* Downloads served by a route handler, not a page — <a> is correct. */}
            <a
              href={`/admin/restaurants/${t.id}/menu-export?format=xlsx`}
              className="border border-white/15 px-3 py-2 text-xs text-neutral-200 hover:border-admin-accent/50 hover:text-white"
            >
              ⬇ Excel (.xlsx)
            </a>
            <a
              href={`/admin/restaurants/${t.id}/menu-export?format=json`}
              className="border border-white/15 px-3 py-2 text-xs text-neutral-200 hover:border-admin-accent/50 hover:text-white"
            >
              ⬇ JSON (backup)
            </a>
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <SequentialImageUploader
              endpoint={`/admin/restaurants/${t.id}/images`}
              hint={
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Upload photos (bulk)
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Pick several at once — they upload one at a time. Name each file to match the{" "}
                    <span className="text-neutral-300">Image</span> column, e.g.{" "}
                    <code className="text-neutral-300">bruschetta.jpg</code>. Re-uploading the same
                    name replaces that photo everywhere.
                  </p>
                </>
              }
            />
          </div>

          <form action={adminImportMenuAction} className="mt-5 border-t border-white/10 pt-4">
            <input type="hidden" name="tenantId" value={t.id} />
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Upload edited menu
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Replaces the draft with the file&apos;s contents. Accepts the exported{" "}
              <code className="text-neutral-300">.xlsx</code> or{" "}
              <code className="text-neutral-300">.json</code>.
            </p>
            <input
              type="file"
              name="file"
              required
              accept=".xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-2 block w-full text-xs text-neutral-300 file:mr-3 file:border file:border-white/15 file:bg-white/[0.03] file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider file:text-neutral-200"
            />
            <SubmitButton
              pendingLabel="Importing…"
              className="mt-3 bg-admin-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-900 hover:bg-admin-accent disabled:opacity-70"
            >
              Upload &amp; replace menu
            </SubmitButton>
          </form>
        </section>

        {/* Danger zone — suspend and soft-delete. Enforcement rides the
            plan derivation, so these switches are instant everywhere. */}
        <section
          aria-label="Danger zone"
          className="mt-10 border border-red-500/20 bg-red-500/[0.03] px-5 py-4"
        >
          <h2 className="text-xs uppercase tracking-[0.2em] text-red-300/80">Danger zone</h2>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {t.deletedAt ? (
              <>
                <form action={setDeletedAction}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <input type="hidden" name="deleted" value="0" />
                  <input type="hidden" name="back" value={`/admin/restaurants/${t.id}`} />
                  <button
                    type="submit"
                    className="border border-emerald-400/50 px-3 py-2 text-xs uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/10"
                  >
                    ♻ Restore restaurant
                  </button>
                </form>
                <PurgeTenantButton tenantId={t.id} name={t.venueName ?? t.name} />
                <span className="text-xs text-neutral-500">
                  Permanent delete erases menus, orders, photos, and the owner&apos;s account.
                </span>
              </>
            ) : (
              <>
                <form action={setStatusAction}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={t.status === "suspended" ? "active" : "suspended"}
                  />
                  <input type="hidden" name="back" value={`/admin/restaurants/${t.id}`} />
                  <button
                    type="submit"
                    className="border border-red-400/40 px-3 py-2 text-xs uppercase tracking-wider text-red-300 hover:bg-red-400/10"
                  >
                    {t.status === "suspended" ? "▶ Reactivate" : "⏸ Suspend"}
                  </button>
                </form>
                {confirmDelete === "1" ? (
                  <form action={setDeletedAction} className="flex items-center gap-2">
                    <input type="hidden" name="tenantId" value={t.id} />
                    <input type="hidden" name="deleted" value="1" />
                    <input type="hidden" name="back" value="/admin/restaurants" />
                    <span className="text-xs text-red-300">
                      Menu goes offline, ordering stops, data is kept. Sure?
                    </span>
                    <button
                      type="submit"
                      className="border border-red-500/70 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-red-300 hover:bg-red-500/20"
                    >
                      Yes, delete
                    </button>
                    <Link
                      href={`/admin/restaurants/${t.id}`}
                      className="text-xs text-neutral-400 underline underline-offset-2"
                    >
                      Cancel
                    </Link>
                  </form>
                ) : (
                  <Link
                    href={`/admin/restaurants/${t.id}?confirmDelete=1`}
                    className="border border-red-400/40 px-3 py-2 text-xs uppercase tracking-wider text-red-300 hover:bg-red-400/10"
                  >
                    🗑 Delete (soft)
                  </Link>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// Module-level so the react-compiler purity rule doesn't see Date.now()
// inside component render (same pattern as the kitchen's ageMinutes).
function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Tiny server-rendered bar chart — one bar per day, no client JS. */
function DayBars({
  title,
  days,
  color,
}: {
  title: string;
  days: { day: Date; n: number }[];
  color: string;
}): React.ReactElement {
  const byKey = new Map(days.map((d) => [d.day.toISOString().slice(0, 10), d.n]));
  const series = lastNDays(14).map((key) => ({
    label: key.slice(5),
    n: byKey.get(key) ?? 0,
  }));
  const max = Math.max(1, ...series.map((s) => s.n));
  const total = series.reduce((sum, s) => sum + s.n, 0);
  return (
    <div className="border border-white/10 bg-white/[0.02] px-5 py-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">{title}</p>
        <p className="font-serif text-xl text-white">{total}</p>
      </div>
      <svg viewBox="0 0 140 40" className="mt-3 h-16 w-full" role="img" aria-label={title}>
        {series.map((s, i) => {
          const h = Math.max(1.5, (s.n / max) * 36);
          return (
            <rect
              key={s.label}
              x={i * 10 + 1}
              y={40 - h}
              width={7}
              height={h}
              rx={1}
              fill={s.n === 0 ? "rgba(255,255,255,0.08)" : color}
            >
              <title>{`${s.label}: ${s.n}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-600">
        <span>{series[0]!.label}</span>
        <span>today</span>
      </div>
    </div>
  );
}
