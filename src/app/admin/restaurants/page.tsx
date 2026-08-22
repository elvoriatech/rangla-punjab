import Link from "next/link";
import { FlashMessage } from "@/components/flash-message";
import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { accessForRow, adminListTenants, adminListTenantsPage } from "@/lib/platform-admin";
import { siteUrl } from "@/lib/public-menu";
import { resendOwnerInviteAction } from "./actions";

/**
 * Guesto platform admin — the operator's view across every tenant.
 * Gated on users.is_platform_admin; non-staff get a 404 (not a 403) so
 * the URL confirms nothing. Dark "control room" look on purpose: this
 * surface must never be mistaken for a restaurant dashboard.
 */

export default async function AdminRestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    page?: string;
    size?: string;
    filter?: string;
    q?: string;
  }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  // Single restaurant per deploy, but the list still pages/searches in SQL
  // so it stays correct if more branches/venues are ever added.
  const tenants = await adminListTenants(userId);
  if (!tenants) notFound();
  const {
    saved,
    error,
    page: pageParam,
    size: sizeParam,
    filter: filterParam,
    q,
  } = await searchParams;

  const query = (q ?? "").trim().toLowerCase();
  const searched = query
    ? tenants.filter((t) =>
        [t.name, t.venueName, t.venueSlug, t.ownerEmail]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query)),
      )
    : tenants;
  const withAccess = searched.map((t) => ({ t, access: accessForRow(t) }));
  // Single-restaurant model: no SaaS trial/lapse funnel — just live vs
  // soft-deleted restaurants.
  const FILTERS = {
    all: {
      label: "All",
      test: (a: { t: (typeof tenants)[number] }) => !a.t.deletedAt,
    },
    deleted: {
      label: "Deleted",
      test: (a: (typeof withAccess)[number]) => Boolean(a.t.deletedAt),
    },
  } as const;
  const filter: keyof typeof FILTERS = filterParam === "deleted" ? "deleted" : "all";
  const filtered = withAccess.filter(FILTERS[filter].test);

  // Pagination: URL-driven (no JS), page size selectable.
  const SIZES = [10, 25, 50, 100] as const;
  const size = SIZES.includes(Number(sizeParam) as (typeof SIZES)[number]) ? Number(sizeParam) : 25;
  let totalPages = Math.max(1, Math.ceil(filtered.length / size));
  let page = Math.min(Math.max(1, Number(pageParam) || 1), totalPages);
  let visibleTenants = filtered.slice((page - 1) * size, page * size);
  let totalShown = filtered.length;
  if (filter === "all") {
    const requested = Math.max(1, Number(pageParam) || 1);
    const dbPage = await adminListTenantsPage(userId, {
      limit: size,
      offset: (requested - 1) * size,
      q: query || undefined,
    });
    if (dbPage) {
      totalShown = dbPage.totalCount;
      totalPages = Math.max(1, Math.ceil(dbPage.totalCount / size));
      page = Math.min(requested, totalPages);
      visibleTenants = dbPage.rows
        .filter((t) => !t.deletedAt)
        .map((t) => ({ t, access: accessForRow(t) }));
    }
  }
  const pageHref = (p: number, s: number): string =>
    `/admin/restaurants?page=${p}&size=${s}&filter=${filter}&q=${encodeURIComponent(query)}`;

  const euro = (cents: number): string =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);

  return (
    <main className="min-h-screen bg-admin-bg px-6 py-10 text-neutral-200 lg:px-12">
      <header className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-white">Restaurants</h1>
          <p className="mt-1 text-sm text-neutral-400">
            The restaurant on this deployment — owner, activity, and its menu.
          </p>
          <Link
            href="/admin/restaurants/new"
            className="mt-3 inline-block bg-admin-accent px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-900 hover:bg-admin-accent"
          >
            + Provision restaurant
          </Link>
        </div>
        <form action="/admin/restaurants" method="get" className="flex items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="size" value={size} />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search name, slug, owner email…"
            className="w-72 max-w-full border border-white/15 bg-admin-surface px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60"
          />
          <button
            type="submit"
            className="border border-white/15 px-3 py-2 text-xs uppercase tracking-wider text-neutral-300 hover:border-admin-accent/50 hover:text-white"
          >
            Search
          </button>
        </form>
      </header>

      {saved ? (
        <FlashMessage
          kind="success"
          text={
            saved === "provisioned"
              ? "Restaurant provisioned — the owner has been emailed a set-password invite."
              : saved === "invited"
                ? "Invite email sent to the owner."
                : "Saved."
          }
        />
      ) : null}
      {error ? <FlashMessage kind="error" text="That didn't work — try again." /> : null}

      <nav aria-label="Tenant filter" className="mx-auto mt-8 flex max-w-6xl gap-2 text-xs">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((key) => {
          const count =
            key === "all" ? tenants.length : withAccess.filter(FILTERS[key].test).length;
          return (
            <a
              key={key}
              href={`/admin/restaurants?filter=${key}&size=${size}&q=${encodeURIComponent(query)}`}
              aria-current={filter === key ? "true" : undefined}
              className={
                filter === key
                  ? "rounded-full border border-admin-accent/60 px-3 py-1.5 text-admin-accent"
                  : "rounded-full border border-white/15 px-3 py-1.5 text-neutral-400 hover:border-white/40 hover:text-white"
              }
            >
              {FILTERS[key].label} · {count}
            </a>
          );
        })}
      </nav>

      <section aria-label="Tenants" className="mx-auto mt-4 max-w-6xl overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              <th className="py-3 pr-4 font-medium">Restaurant</th>
              <th className="py-3 pr-4 font-medium">Owner</th>
              <th className="py-3 pr-4 font-medium">Features</th>
              <th className="py-3 pr-4 text-right font-medium">Today</th>
              <th className="py-3 pr-4 text-right font-medium">30 days</th>
              <th className="py-3 pr-4 text-right font-medium">Volume 30d</th>
              <th className="py-3 font-medium">Menu</th>
            </tr>
          </thead>
          <tbody>
            {visibleTenants.map(({ t, access }) => {
              const ent = access.entitlements;
              const suspended = access.state === "suspended" || access.state === "deleted";
              const stateLabel = t.deletedAt
                ? "Deleted"
                : t.status === "suspended"
                  ? "Suspended"
                  : "Active";
              return (
                <tr key={t.id} className="border-b border-white/5 align-top">
                  <td className="py-3 pr-4">
                    <a
                      href={`/admin/restaurants/${t.id}`}
                      className="font-medium text-white underline-offset-2 hover:underline"
                    >
                      {t.venueName ?? t.name}
                    </a>
                    <p className="text-xs text-neutral-500">
                      since{" "}
                      {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(
                        t.createdAt,
                      )}
                      {t.status !== "active" ? ` · ${t.status}` : ""}
                    </p>
                    <p
                      className={
                        suspended
                          ? "mt-0.5 text-xs text-red-400"
                          : "mt-0.5 text-xs text-emerald-300"
                      }
                    >
                      {stateLabel}
                    </p>
                  </td>
                  <td className="py-3 pr-4">
                    {t.ownerEmail ? (
                      <>
                        <p className="text-sm text-neutral-200">{t.ownerEmail}</p>
                        <form action={resendOwnerInviteAction} className="mt-1.5">
                          <input type="hidden" name="ownerEmail" value={t.ownerEmail} />
                          <button
                            type="submit"
                            title="Email the owner a link to set their password"
                            className="border border-admin-accent/40 px-2.5 py-1 text-[11px] uppercase tracking-wider text-admin-accent hover:bg-admin-accent/10"
                          >
                            ✉ Resend invite
                          </button>
                        </form>
                      </>
                    ) : (
                      <span className="text-xs text-neutral-600">no owner</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs leading-6 text-neutral-400">
                    {ent.dineIn ? "🍽 " : ""}
                    {ent.takeaway ? "🥡 " : ""}
                    {ent.delivery ? "🛵 " : ""}
                    {ent.kitchen ? "🖥 " : ""}
                    {ent.stats ? "📊" : ""}
                    {!ent.dineIn && !ent.takeaway && !ent.delivery ? "ordering off" : ""}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-white">{t.ordersToday}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{t.orders30d}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{euro(t.revenue30dCents)}</td>
                  <td className="py-3">
                    {t.venueSlug ? (
                      <a
                        href={`${siteUrl()}/`}
                        className="text-xs text-admin-accent/90 underline underline-offset-2 hover:text-admin-accent"
                      >
                        /
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-600">no venue yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">No restaurants match.</p>
        ) : (
          <nav
            aria-label="Pagination"
            className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-4 text-xs text-neutral-400"
          >
            <span>
              {(page - 1) * size + 1}–{Math.min(page * size, totalShown)} of {totalShown}{" "}
              restaurants
            </span>
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                Rows:
                {SIZES.map((s) => (
                  <a
                    key={s}
                    href={pageHref(1, s)}
                    aria-current={s === size ? "true" : undefined}
                    className={
                      s === size
                        ? "rounded border border-admin-accent/50 px-1.5 py-0.5 text-admin-accent"
                        : "px-1 text-neutral-400 underline-offset-2 hover:text-white hover:underline"
                    }
                  >
                    {s}
                  </a>
                ))}
              </span>
              <span className="flex items-center gap-2">
                {page > 1 ? (
                  <a href={pageHref(page - 1, size)} className="hover:text-white">
                    ← Prev
                  </a>
                ) : (
                  <span className="opacity-40">← Prev</span>
                )}
                <span className="tabular-nums">
                  Page {page} / {totalPages}
                </span>
                {page < totalPages ? (
                  <a href={pageHref(page + 1, size)} className="hover:text-white">
                    Next →
                  </a>
                ) : (
                  <span className="opacity-40">Next →</span>
                )}
              </span>
            </span>
          </nav>
        )}
      </section>
    </main>
  );
}
