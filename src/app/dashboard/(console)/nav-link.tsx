"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sidebar nav item with active state. The gold left rule marks "you are
 * here" — the only client component in the shell, kept tiny on purpose.
 */
export function NavLink({
  href,
  exact = false,
  newTab = false,
  children,
}: {
  href: string;
  exact?: boolean;
  /** Open in a separate browser tab (kitchen display → full screen). */
  newTab?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  if (newTab) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block border-l-2 border-transparent px-3 py-2 text-[12px] uppercase tracking-[0.22em] text-[var(--menu-text-soft)] transition-colors hover:border-[var(--menu-accent)]/40 hover:text-[var(--menu-text)]"
      >
        {children} <span aria-hidden="true">↗</span>
      </a>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "block border-l-2 border-[var(--menu-accent)] bg-[var(--menu-surface)] px-3 py-2 text-[12px] uppercase tracking-[0.22em] text-[var(--menu-accent)]"
          : "block border-l-2 border-transparent px-3 py-2 text-[12px] uppercase tracking-[0.22em] text-[var(--menu-text-soft)] transition-colors hover:border-[var(--menu-accent)]/40 hover:text-[var(--menu-text)]"
      }
    >
      {children}
    </Link>
  );
}
