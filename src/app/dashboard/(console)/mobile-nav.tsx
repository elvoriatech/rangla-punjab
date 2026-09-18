"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { logoutAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * Mobile top bar for the dashboard: a hamburger that toggles the nav
 * drawer, the venue's logo (or an initial-letter fallback), and the venue
 * name. Replaces the old always-open horizontal scroller so small screens
 * lead with identity, not a wall of links.
 */
export function MobileNav({
  items,
  venueName,
  logoUrl,
  railStyle,
}: {
  items: readonly { href: string; label: string; newTab?: boolean }[];
  venueName: string;
  logoUrl: string | null;
  railStyle: React.CSSProperties;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div
      style={railStyle}
      className="sticky top-0 z-20 border-b border-[var(--menu-line)] bg-[var(--menu-bg)] md:hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="shrink-0 text-[var(--menu-text)]"
        >
          {open ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
        </button>

        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full border border-[var(--menu-line)] object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--menu-line)] bg-[var(--menu-surface)] font-serif text-sm italic text-[var(--menu-accent)]"
          >
            {venueName.slice(0, 1).toUpperCase()}
          </span>
        )}

        <Link
          href="/"
          target="_blank"
          rel="noopener"
          title="Open the public menu"
          className="min-w-0 flex-1 truncate font-serif text-lg italic text-[var(--menu-text)] hover:underline"
        >
          {venueName}
        </Link>

        <form action={logoutAction}>
          <SubmitButton
            pendingLabel="Logging out…"
            className="text-[10px] uppercase tracking-[0.22em] text-[var(--menu-text-soft)]"
          >
            Log out
          </SubmitButton>
        </form>
      </div>

      {open ? (
        <nav aria-label="Dashboard" className="border-t border-[var(--menu-line)] px-2 pb-3 pt-1">
          <ul className="flex flex-col">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    target={item.newTab ? "_blank" : undefined}
                    rel={item.newTab ? "noreferrer" : undefined}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`block px-3 py-2.5 text-xs uppercase tracking-[0.18em] ${
                      active
                        ? "text-[var(--menu-accent)]"
                        : "text-[var(--menu-text-soft)] hover:text-[var(--menu-text)]"
                    }`}
                  >
                    {item.label}
                    {item.newTab ? <span aria-hidden> ↗</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
