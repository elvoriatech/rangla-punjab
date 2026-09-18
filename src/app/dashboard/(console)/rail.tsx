"use client";

import { BRAND } from "@/lib/brand";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  ChefHat,
  CalendarCheck,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  PanelLeftOpen,
  QrCode,
  ReceiptText,
  Rocket,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { logoutAction, setActiveVenueAction } from "./actions";
import type { OwnerVenue } from "@/lib/active-venue";
import { publishMenuAction } from "./categories/actions";

/**
 * The dashboard rail, now collapsible: icons always, labels only when
 * expanded. Collapsed width keeps every destination one tap away and
 * gives the content area the room back — handy on the menu editor.
 * State persists per browser via localStorage. Dressed in the venue's
 * own menu theme (CSS vars from the server layout), same as before.
 */

const STORAGE_KEY = "guesto.dashboard.rail";

interface RailItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  newTab?: boolean;
}

function buildNav(base: string): RailItem[] {
  return [
    { href: base, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `${base}/orders`, label: "Orders", icon: ReceiptText },
    { href: `${base}/reservations`, label: "Reservations", icon: CalendarCheck },
    { href: "/kitchen", label: "Kitchen", icon: ChefHat, newTab: true },
    { href: `${base}/categories`, label: "Menu", icon: BookOpenText },
    { href: `${base}/appearance`, label: "Appearance", icon: Palette },
    { href: `${base}/qr`, label: "QR codes", icon: QrCode },
    { href: `${base}/settings`, label: "Settings", icon: Settings },
    { href: `${base}/billing`, label: "Payments", icon: CreditCard },
  ];
}

export function DashboardRail({
  base,
  venueName,
  logoUrl,
  railStyle,
  canPublish,
  everPublished,
  venues,
  activeVenueId,
}: {
  base: string;
  venueName: string;
  logoUrl: string | null;
  railStyle: React.CSSProperties;
  /** Draft holds edits guests can't see → the Publish button lights up. */
  canPublish: boolean;
  everPublished: boolean;
  /** All branches the tenant owns; the switcher shows only when >1. */
  venues: OwnerVenue[];
  activeVenueId: string | null;
}) {
  const [publishing, setPublishing] = useState(false);
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Deferred a tick: the react-hooks rule forbids synchronous setState
    // inside effects (cascading-render hazard). Same pattern as the
    // marketing fail-open hooks.
    const id = setTimeout(() => {
      // Explicit choice wins. Otherwise: tablets clipped to the counter
      // (< 1024 px) start collapsed so the work area gets the width; a
      // desktop starts expanded.
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setCollapsed(stored ? stored === "collapsed" : window.innerWidth < 1024);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    // Publish finished (server revalidated the layout with fresh state)
    // → drop the optimistic "Publishing…" label.
    const id = setTimeout(() => setPublishing(false), 0);
    return () => clearTimeout(id);
  }, [canPublish]);

  const toggle = () => {
    setCollapsed((c) => {
      window.localStorage.setItem(STORAGE_KEY, c ? "expanded" : "collapsed");
      return !c;
    });
  };

  const NAV = buildNav(base);
  const itemBase = collapsed
    ? "flex items-center justify-center px-0 py-2.5"
    : "flex items-center gap-3 border-l-2 px-3 py-2";

  return (
    <aside
      style={railStyle}
      className={`sticky top-0 hidden h-screen shrink-0 flex-col justify-between border-r border-[var(--menu-line)] bg-[var(--menu-bg)] text-[var(--menu-text)] transition-[width] duration-200 md:flex ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="min-h-0 overflow-y-auto">
        <div
          className={`flex items-center border-b border-[var(--menu-line)] py-5 ${
            collapsed ? "flex-col gap-3 px-0" : "gap-3 px-4"
          }`}
        >
          {collapsed ? (
            <>
              <Link href="/" target="_blank" rel="noopener" title="Open the public menu">
                <RailLogo logoUrl={logoUrl} venueName={venueName} />
              </Link>
              <button
                type="button"
                onClick={toggle}
                aria-label="Expand sidebar"
                className="text-[var(--menu-text-soft)] hover:text-[var(--menu-text)]"
              >
                <PanelLeftOpen className="h-5 w-5" aria-hidden />
              </button>
            </>
          ) : (
            <>
              <RailLogo logoUrl={logoUrl} venueName={venueName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] uppercase tracking-[0.34em] text-[var(--menu-accent)]">
                  {BRAND.name}
                </p>
                {/* The venue name doubles as "view my menu": the public
                    page opens in a new tab so the console stays put. */}
                <Link
                  href="/"
                  target="_blank"
                  rel="noopener"
                  title="Open the public menu"
                  className="block min-w-0 truncate font-serif text-xl italic leading-tight text-[var(--menu-text)] hover:underline focus-visible:underline"
                >
                  {venueName}
                </Link>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label="Collapse sidebar"
                className="shrink-0 text-[var(--menu-text-soft)] hover:text-[var(--menu-text)]"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </button>
            </>
          )}
        </div>
        {venues.length > 1 && !collapsed ? (
          <div className="px-3 pt-4">
            <form action={setActiveVenueAction}>
              <label
                htmlFor="branch-switcher"
                className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-[var(--menu-text-soft)]"
              >
                Branch
              </label>
              <select
                id="branch-switcher"
                name="venueId"
                defaultValue={activeVenueId ?? undefined}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="w-full border border-[var(--menu-line)] bg-[var(--menu-bg)] px-2 py-1.5 text-sm text-[var(--menu-text)]"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <noscript>
                <button type="submit" className="mt-1 text-[10px] underline">
                  Switch
                </button>
              </noscript>
            </form>
          </div>
        ) : null}
        <div className="px-3 pt-4">
          <form
            action={publishMenuAction}
            onSubmit={() => setPublishing(true)}
            title={
              canPublish
                ? "Make your draft changes live for guests"
                : everPublished
                  ? "Everything is published — no unpublished changes"
                  : "Add categories and dishes first"
            }
          >
            <button
              type="submit"
              disabled={!canPublish || publishing}
              className={`flex w-full items-center justify-center gap-2 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition ${
                canPublish && !publishing
                  ? "bg-[var(--menu-accent)] text-[var(--menu-bg)] shadow-[0_10px_24px_-12px_var(--menu-accent)] hover:opacity-90 active:scale-[0.98]"
                  : "cursor-not-allowed border border-[var(--menu-line)] text-[var(--menu-text-soft)] opacity-50"
              } ${collapsed ? "px-0" : "px-3"}`}
            >
              <Rocket className="h-4 w-4 shrink-0" aria-hidden />
              {collapsed ? (
                <span className="sr-only">Publish menu</span>
              ) : (
                <span>{publishing ? "Publishing…" : canPublish ? "Publish" : "Published"}</span>
              )}
            </button>
          </form>
        </div>
        <nav aria-label="Dashboard" className="px-3 py-4">
          <ul className="space-y-1">
            {NAV.map(({ href, label, icon: Icon, exact, newTab }) => {
              const active = exact
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);
              const stateClass = collapsed
                ? active
                  ? "text-[var(--menu-accent)]"
                  : "text-[var(--menu-text-soft)] hover:text-[var(--menu-text)]"
                : active
                  ? "border-[var(--menu-accent)] bg-[var(--menu-surface)] text-[var(--menu-accent)]"
                  : "border-transparent text-[var(--menu-text-soft)] transition-colors hover:border-[var(--menu-accent)]/40 hover:text-[var(--menu-text)]";
              const label11 = (
                <span className="text-[12px] uppercase tracking-[0.22em]">
                  {label}
                  {newTab ? <span aria-hidden> ↗</span> : null}
                </span>
              );
              return (
                <li key={href}>
                  {newTab ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      title={collapsed ? label : undefined}
                      className={`${itemBase} ${stateClass}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {collapsed ? <span className="sr-only">{label}</span> : label11}
                    </a>
                  ) : (
                    <Link
                      href={href}
                      title={collapsed ? label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={`${itemBase} ${stateClass}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {collapsed ? <span className="sr-only">{label}</span> : label11}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <div className="border-t border-[var(--menu-line)] px-3 py-4">
        <a
          href={`/`}
          target="_blank"
          rel="noreferrer"
          title={collapsed ? "View public menu" : undefined}
          className={`${itemBase} border-transparent text-[var(--menu-accent)] underline-offset-4 hover:underline`}
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          {collapsed ? (
            <span className="sr-only">View public menu</span>
          ) : (
            <span className="text-[11px] uppercase tracking-[0.22em]">View public menu ↗</span>
          )}
        </a>
        <form action={logoutAction}>
          <button
            type="submit"
            title={collapsed ? "Log out" : undefined}
            className={`${itemBase} w-full border-transparent text-left text-[var(--menu-text-soft)] hover:text-[var(--menu-text)]`}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            {collapsed ? (
              <span className="sr-only">Log out</span>
            ) : (
              <span className="text-[11px] uppercase tracking-[0.22em]">Log out</span>
            )}
          </button>
        </form>
      </div>
    </aside>
  );
}

/**
 * The venue's logo, or a themed initial-letter avatar when none is set —
 * so the rail header always leads with a mark, never an empty gap.
 */
function RailLogo({ logoUrl, venueName }: { logoUrl: string | null; venueName: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        title={venueName}
        className="h-10 w-10 shrink-0 rounded-full border border-[var(--menu-line)] object-cover"
      />
    );
  }
  return (
    <span
      title={venueName}
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--menu-line)] bg-[var(--menu-surface)] font-serif text-lg italic text-[var(--menu-accent)]"
    >
      {venueName.slice(0, 1).toUpperCase()}
    </span>
  );
}
