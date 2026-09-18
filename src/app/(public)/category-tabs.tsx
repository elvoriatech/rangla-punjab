"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Category rail with instant, client-side filtering.
 *
 * The server renders EVERY category section (each wrapped in
 * `[data-category-id]`) and, for a `?cat=` deep link, marks the others
 * `hidden`. A tap here flips those `hidden` attributes and rewrites the URL
 * with history.replaceState — no navigation, no server round trip, no
 * scroll jump, the sticky rails never re-render. The anchors keep their
 * `?cat=` hrefs, so without JavaScript (and for search engines) the same
 * tap is an ordinary link to the server-filtered page.
 *
 * Three copies of this rail exist on the page (desktop, tablet row, hero
 * row); a tiny external store keeps their active state in sync.
 */

const store = {
  value: undefined as string | null | undefined,
  listeners: new Set<() => void>(),
};
function subscribe(cb: () => void): () => void {
  store.listeners.add(cb);
  return () => store.listeners.delete(cb);
}
function setActive(id: string | null): void {
  store.value = id;
  for (const cb of store.listeners) cb();
}

function applyFilter(id: string | null): boolean {
  const sections = document.querySelectorAll<HTMLElement>("[data-category-id]");
  if (id !== null && !Array.from(sections).some((s) => s.dataset.categoryId === id)) {
    // Not on the page (e.g. emptied by the diet filter): let the link do a
    // real navigation so the server renders its empty state.
    return false;
  }
  for (const s of sections) s.hidden = id !== null && s.dataset.categoryId !== id;
  return true;
}

function syncUrlAndDietLinks(catSlug: string | null): void {
  const url = new URL(window.location.href);
  if (catSlug) url.searchParams.set("cat", catSlug);
  else url.searchParams.delete("cat");
  window.history.replaceState(window.history.state, "", url.toString());
  // Diet tabs are server links carrying the category — keep them honest.
  // Matched on the data attribute, never the aria-label: that label is
  // translated (menu-view renders it from the guest-copy catalogue) and a
  // selector built on it would silently stop matching in German.
  for (const a of document.querySelectorAll<HTMLAnchorElement>("nav[data-diet-filter] a")) {
    const u = new URL(a.href, window.location.origin);
    if (catSlug) u.searchParams.set("cat", catSlug);
    else u.searchParams.delete("cat");
    a.href = u.pathname + u.search;
  }
}

export function TabLink({
  href,
  active,
  variant,
  children,
  onClick,
}: {
  href: string;
  active: boolean;
  variant: "primary" | "secondary";
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}): React.ReactElement {
  // Squared tabs (no `rounded-*`) — restaurant-menu convention: text
  // with an underline for the active state, subtle background for the
  // hover state. Primary = category rail (bigger, more prominent).
  // Secondary = diet rail (smaller, quieter).
  const base = "inline-flex items-center px-4 py-2 transition-all duration-200";
  const cls =
    variant === "primary"
      ? active
        ? `${base} rounded-2xl [border-end-end-radius:3px] bg-[var(--menu-surface-accent,var(--menu-accent))] font-semibold text-[var(--menu-surface,#fffdf8)] shadow-sm`
        : `${base} rounded-2xl text-[var(--menu-text)] hover:text-[var(--menu-accent)]`
      : active
        ? `${base} rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))]/12 font-semibold text-[var(--menu-surface-accent,var(--menu-accent))] px-3 py-1.5`
        : `${base} rounded-full text-[var(--menu-surface-text,var(--menu-text))] hover:text-[var(--menu-accent)] px-3 py-1.5`;
  // prefetch={false}: 16 category tabs × viewport prefetch would hammer
  // the server for filters most guests never tap.
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cls}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

/**
 * One category link for rails that lay themselves out (the desktop side
 * rail): same store, same instant filter, caller supplies the classes.
 */
export function CategoryLink({
  id,
  slug,
  href,
  initialActive,
  activeClass,
  idleClass,
  children,
}: {
  /** null = "All". */
  id: string | null;
  slug: string | null;
  href: string;
  initialActive: string | null;
  activeClass: string;
  idleClass: string;
  children: React.ReactNode;
}): React.ReactElement {
  const current = useSyncExternalStore(
    subscribe,
    () => (store.value === undefined ? initialActive : store.value),
    () => initialActive,
  );
  const active = current === id;
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={active ? activeClass : idleClass}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (!applyFilter(id)) return;
        e.preventDefault();
        setActive(id);
        syncUrlAndDietLinks(id ? slug : null);
        document.getElementById("menu")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {children}
    </Link>
  );
}

export function CategoryTabs({
  categories,
  slugs,
  active,
  activeDiet,
  showIcons,
  icons,
  navLabel,
  allLabel,
}: {
  categories: { id: string; name: string }[];
  /** id → URL slug, precomputed on the server. */
  slugs: Record<string, string>;
  active: string | null;
  activeDiet: string | null;
  showIcons: boolean;
  /** id → icon glyph, precomputed on the server (keeps the icon table out
   *  of the client bundle). */
  icons: Record<string, string>;
  /** The two translated strings this rail renders, resolved on the server
   *  so the guest-copy catalogue never enters the client bundle. */
  navLabel: string;
  allLabel: string;
}): React.ReactElement | null {
  const current = useSyncExternalStore(
    subscribe,
    () => (store.value === undefined ? active : store.value),
    () => active,
  );
  // A server navigation (diet change, deep link) hands us a new `active`;
  // it wins over whatever a previous tap stored.
  useEffect(() => {
    setActive(active);
  }, [active]);

  if (categories.length < 2) return null;
  const dietQs = activeDiet ? `&diet=${activeDiet}` : "";

  const pick =
    (id: string | null) =>
    (e: React.MouseEvent<HTMLAnchorElement>): void => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (!applyFilter(id)) return; // fall through to the real link
      e.preventDefault();
      setActive(id);
      syncUrlAndDietLinks(id ? (slugs[id] ?? id) : null);
      document.getElementById("menu")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

  return (
    <nav aria-label={navLabel} className="-mx-1 w-full overflow-x-auto">
      <ul className="mx-auto flex w-max min-w-max items-center gap-1 px-1 text-[11px] uppercase tracking-[0.28em]">
        <li>
          <TabLink
            href={`/${activeDiet ? `?diet=${activeDiet}` : ""}`}
            active={current === null}
            variant="primary"
            onClick={pick(null)}
          >
            {allLabel}
          </TabLink>
        </li>
        {categories.map((c) => (
          <li key={c.id}>
            <TabLink
              href={`/?cat=${slugs[c.id] ?? c.id}${dietQs}`}
              active={current === c.id}
              variant="primary"
              onClick={pick(c.id)}
            >
              {showIcons ? (
                <span aria-hidden="true" className="me-1.5 text-sm normal-case tracking-normal">
                  {icons[c.id]}
                </span>
              ) : null}
              {c.name}
            </TabLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
