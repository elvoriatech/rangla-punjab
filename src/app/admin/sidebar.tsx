"use client";

import { BRAND } from "@/lib/brand";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  DatabaseBackup,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  Store,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { logoutAction } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Collapsible admin sidebar: icons always, labels only when expanded.
 * The collapsed state persists per browser (localStorage) so staff who
 * prefer the extra content width keep it across sessions. Icon-only
 * mode keeps every destination one click away — links carry title
 * tooltips for recognition.
 */

const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/restaurants", label: "Restaurants", icon: Store },
  { href: "/admin/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
  { href: "/admin/backups", label: "Backups", icon: DatabaseBackup },
  { href: "/admin/runbooks", label: "Runbooks", icon: LifeBuoy },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/system", label: "System", icon: Activity },
];

const STORAGE_KEY = "guesto.admin.rail";

export function AdminSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logoutFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Deferred a tick: the react-hooks rule forbids synchronous setState
    // inside effects (cascading-render hazard). Same pattern as the
    // marketing fail-open hooks.
    const id = setTimeout(() => {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "collapsed");
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      window.localStorage.setItem(STORAGE_KEY, c ? "expanded" : "collapsed");
      return !c;
    });
  };

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-white/10 transition-[width] duration-200 max-md:hidden ${
        collapsed ? "w-16" : "w-52"
      }`}
    >
      <div className={`flex items-start py-6 ${collapsed ? "justify-center px-2" : "px-5"}`}>
        {collapsed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/guesto-icon.svg" alt="" className="h-8 w-8 rounded-lg" />
        ) : (
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.34em] text-admin-accent/80">
              {BRAND.name}
            </p>
            <p className="mt-0.5 truncate font-serif text-lg text-white">Platform admin</p>
          </div>
        )}
      </div>

      <nav aria-label="Admin" className="flex-1 px-3">
        <ul className="space-y-0.5 text-sm">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 border-l-2 px-3 py-2 transition-colors ${
                    active
                      ? "border-admin-accent bg-white/[0.05] text-white"
                      : "border-transparent text-neutral-400 hover:border-admin-accent/40 hover:text-white"
                  } ${collapsed ? "justify-center border-l-0 px-0" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {collapsed ? <span className="sr-only">{label}</span> : <span>{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 pb-2">
        <form ref={logoutFormRef} action={logoutAction}>
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            title={collapsed ? "Log out" : undefined}
            className={`flex w-full items-center gap-3 border-l-2 border-transparent px-3 py-2 text-sm text-neutral-400 transition-colors hover:border-admin-accent/40 hover:text-white ${
              collapsed ? "justify-center border-l-0 px-0" : ""
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            {collapsed ? <span className="sr-only">Log out</span> : <span>Log out</span>}
          </button>
        </form>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mt-1 flex w-full items-center gap-3 border-l-2 border-transparent px-3 py-2 text-sm text-neutral-500 transition-colors hover:text-white ${
            collapsed ? "justify-center border-l-0 px-0" : ""
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>

      {collapsed ? null : (
        <p className="px-5 pb-4 text-[10px] uppercase tracking-[0.2em] text-neutral-600">
          Staff only · audited
        </p>
      )}

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        message="You'll return to the login page. Any form you're mid-way through is lost."
        confirmLabel="Log out"
        onConfirm={() => {
          setConfirmLogout(false);
          logoutFormRef.current?.requestSubmit();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </aside>
  );
}
