import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getMenuStatus } from "@/lib/menu-versions-service";
import { getMenuCounts, getOrderingSettings, getVenueForUser } from "@/lib/venue-service";
import { getOrderStats } from "@/lib/order-service";
import { formatPrice } from "@/lib/public-menu";
import { siteHost } from "@/lib/site-url";
import { resolveMenuTexture, resolveMenuTheme } from "@/lib/menu-themes";
import { publishMenuAction } from "./categories/actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * Owner overview — the "front desk" of the dashboard. Visual hierarchy:
 * publish state first (the only thing guests notice), then money, then
 * menu shape, then doors to everything else. One card language
 * throughout: warm card surface, hairline border, soft grounded shadow.
 */

const CARD =
  "border border-ink/10 bg-card shadow-[0_1px_2px_rgba(42,26,14,0.04),0_12px_32px_-24px_rgba(42,26,14,0.25)]";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");
  const venue = venueResult.value;

  const [status, counts, stats, orderingSettings] = await Promise.all([
    getMenuStatus(userId),
    getMenuCounts(userId),
    getOrderStats(userId),
    getOrderingSettings(userId),
  ]);
  const access = orderingSettings.ok ? orderingSettings.value.access : null;
  const money = (cents: number): string => formatPrice(cents, venue.currency, "de");
  const live = Boolean(status.publishedAt);
  const publishedLabel = status.publishedAt
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(new Date(status.publishedAt))
    : null;
  const bestDayLabel = stats.bestDay
    ? new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "short",
        timeZone: "Europe/Berlin",
      }).format(new Date(`${stats.bestDay.date}T12:00:00`))
    : null;
  const theme = resolveMenuTheme(venue.branding.theme);
  const texture = resolveMenuTexture(venue.branding.texture);
  const base = `/dashboard`;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12 text-ink lg:px-10">
      {/* Header */}
      <header>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-dark">Overview</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">{venue.name}</h1>
          <a
            href={`/`}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 border border-ink/15 bg-card px-3.5 py-1.5 text-xs text-muted transition-colors hover:border-orange/50 hover:text-ink"
          >
            <span
              aria-hidden="true"
              className={
                live
                  ? "h-1.5 w-1.5 rounded-full bg-[#3f7030]"
                  : "h-1.5 w-1.5 rounded-full bg-orange"
              }
            />
            {siteHost()}/
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              ↗
            </span>
          </a>
        </div>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Every printed QR code points at that address — it never changes, even when the menu does.
        </p>
      </header>

      {/* Publish state — the hero */}
      <section
        aria-label="Publish status"
        className={`${CARD} mt-10 border-l-4 ${live ? "border-l-gold-dark" : "border-l-orange"} px-6 py-5`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div>
            <p className="flex items-center gap-2.5 font-serif text-2xl">
              <span
                aria-hidden="true"
                className={
                  live ? "h-2 w-2 rounded-full bg-[#3f7030]" : "h-2 w-2 rounded-full bg-orange"
                }
              />
              {live ? "Menu is live" : "Not published yet"}
            </p>
            <p className="mt-1.5 text-sm text-muted">
              {live
                ? `Last published ${publishedLabel}. Draft edits stay private until you publish again.`
                : "Guests see nothing until you publish. Finish the menu, then press Publish."}
            </p>
          </div>
          <form action={publishMenuAction}>
            <SubmitButton
              pendingLabel="Publishing…"
              className="bg-orange px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-card shadow-[0_8px_16px_-8px_rgba(194,90,34,0.5)] transition-colors hover:bg-orange-dark"
            >
              Publish menu
            </SubmitButton>
          </form>
        </div>
      </section>

      {/* Trial setup notice — hardware question answered where it helps:
          while they're wiring up the kitchen, not when the trial ends. */}
      {access?.state === "trial" ? (
        <section
          aria-label="Getting set up"
          className="mt-10 border border-gold/40 bg-card px-6 py-5"
        >
          <p className="text-xs uppercase tracking-[0.28em] text-gold-dark">
            Trial · {access.trialDaysLeft} days left — everything unlocked
          </p>
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-ink">No special hardware needed:</span> any tablet or
            phone runs the kitchen display — open it, tap fullscreen, done. Tickets print on any
            printer your device knows; an 80&nbsp;mm thermal printer (from ~€50) makes them
            kitchen-proof. Prefer it ready-made? We offer a pre-configured tablet + printer from
            €12/month — just reply to your welcome email.
          </p>
        </section>
      ) : null}
      {access && (access.state === "suspended" || access.state === "deleted") ? (
        <section
          aria-label="Account unavailable"
          className="mt-10 border border-red-800/40 bg-red-50 px-6 py-5"
        >
          <p className="text-sm font-medium text-red-900">
            This account is currently suspended — your public menu and guest ordering are offline.
          </p>
          <p className="mt-1 text-sm text-red-900/80">
            If you believe this is a mistake, contact support@guesto.app and we&apos;ll sort it out.
          </p>
        </section>
      ) : null}
      {access && (access.state === "lapsed_grace" || access.state === "lapsed_off") ? (
        <section
          aria-label="Plan needed"
          className="mt-10 border border-red-800/40 bg-red-50 px-6 py-5"
        >
          <p className="text-sm font-medium text-red-900">
            Your trial has ended — guest ordering is paused
            {access.state === "lapsed_off" ? " and your menu is offline" : ""}.
          </p>
          <p className="mt-1 text-sm text-red-900/80">
            Pick a plan to switch everything back on.{" "}
            <a href="billing" className="underline underline-offset-2">
              Choose a plan →
            </a>
          </p>
        </section>
      ) : null}

      {/* Sales */}
      <section aria-label="Sales" className="mt-12">
        <SectionHeading title="Orders" hint="Self-ordering through your QR menu" />
        {access && !access.entitlements.stats ? (
          <p className="mt-4 border border-ink/15 bg-card px-6 py-6 text-sm text-muted">
            Sales stats (orders today, this month, best day) are part of the{" "}
            <span className="font-medium text-ink">Growth</span> plan.{" "}
            <a href="billing" className="text-orange-dark underline underline-offset-2">
              Upgrade to see your numbers →
            </a>
          </p>
        ) : null}
        <div
          className={
            access && !access.entitlements.stats
              ? "hidden"
              : "mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3"
          }
        >
          <Metric
            value={String(stats.today.orders)}
            label="Orders today"
            detail={money(stats.today.revenueCents)}
          />
          <Metric
            value={String(stats.month.orders)}
            label="Orders this month"
            detail={money(stats.month.revenueCents)}
          />
          {stats.bestDay ? (
            <Metric
              value={bestDayLabel!}
              valueSize="text-[1.65rem]"
              label="Best day this month"
              detail={`${money(stats.bestDay.revenueCents)} · ${stats.bestDay.orders} orders`}
              starred
            />
          ) : (
            <Metric value="—" label="Best day this month" detail="No orders yet this month" muted />
          )}
        </div>
      </section>

      {/* Menu at a glance — one strip, not four boxes */}
      <section aria-label="Menu at a glance" className="mt-12">
        <SectionHeading title="Menu at a glance" />
        <div
          className={`${CARD} mt-4 grid grid-cols-2 divide-x divide-y divide-ink/10 sm:grid-cols-4 sm:divide-y-0`}
        >
          <GlanceCell value={String(counts.categories)} label="Categories" />
          <GlanceCell value={String(counts.items)} label="Dishes" />
          <GlanceCell value={String(venue.enabledLocales.length)} label="Languages" />
          <GlanceCell value={venue.currency} label="Currency" />
        </div>
      </section>

      {/* Manage */}
      <section aria-label="Manage" className="mt-12 pb-4">
        <SectionHeading title="Manage" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ManageCard
            href={`${base}/categories`}
            title="Edit the menu"
            body="Categories, dishes, prices, and allergens."
          />
          <ManageCard
            href={`${base}/orders`}
            title="Kitchen orders"
            body="Live tickets from guests — leave it open in the kitchen."
          />
          <ManageCard
            href={`${base}/appearance`}
            title="Appearance"
            body={`${theme.label} theme · ${texture.label} texture.`}
          />
          <ManageCard
            href={`${base}/qr`}
            title="QR codes"
            body="Print-ready codes for table tents, windows, and flyers."
          />
          <ManageCard
            href={`${base}/settings`}
            title="Settings"
            body="Name, logo, currency, languages, and diet filters."
          />
          <ManageCard
            href={`${base}/billing`}
            title="Billing"
            body="Your plan, invoices, and payment method."
          />
        </div>
      </section>
    </main>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">{title}</h2>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      <span aria-hidden="true" className="hidden h-px flex-1 bg-ink/10 sm:block" />
    </div>
  );
}

function Metric({
  value,
  label,
  detail,
  valueSize = "text-4xl",
  starred = false,
  muted = false,
}: {
  value: string;
  label: string;
  detail: string;
  valueSize?: string;
  starred?: boolean;
  muted?: boolean;
}): React.ReactElement {
  return (
    <div className={`${CARD} relative overflow-hidden px-5 py-5`}>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-gold/60" />
      <p className={`font-serif ${valueSize} leading-tight tabular-nums`}>
        {starred ? (
          <span aria-hidden="true" className="mr-1.5 text-xl text-gold-dark">
            ★
          </span>
        ) : null}
        {value}
      </p>
      <p className="mt-1.5 text-[11px] uppercase tracking-[0.22em] text-muted">{label}</p>
      <p
        className={
          muted
            ? "mt-2.5 text-sm text-muted"
            : "mt-2.5 text-sm font-semibold tabular-nums text-orange-dark"
        }
      >
        {detail}
      </p>
    </div>
  );
}

function GlanceCell({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <div className="px-5 py-4 text-center">
      <p className="font-serif text-3xl tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted">{label}</p>
    </div>
  );
}

function ManageCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className={`${CARD} group block px-5 py-4 transition-all hover:-translate-y-0.5 hover:border-orange/40 hover:shadow-[0_1px_2px_rgba(42,26,14,0.04),0_16px_32px_-20px_rgba(194,90,34,0.35)]`}
    >
      <p className="flex items-baseline justify-between gap-3 font-serif text-xl">
        {title}
        <span
          aria-hidden="true"
          className="text-base text-muted transition-all group-hover:translate-x-1 group-hover:text-orange-dark"
        >
          →
        </span>
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </Link>
  );
}
