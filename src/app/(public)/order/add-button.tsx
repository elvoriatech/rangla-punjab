"use client";

import { useEffect, useRef, useState } from "react";
import { addToCart } from "./cart-store";
import { checkoutCopy } from "@/lib/i18n/checkout";

/**
 * "Add" button on every dish card. Styled entirely from the menu theme
 * vars so it belongs to whichever theme renders it. Flashes "Added ✓"
 * as feedback, then returns to rest.
 */
export function AddToOrderButton({
  slug,
  itemId,
  name,
  priceCents,
  locale,
}: {
  slug: string;
  itemId: string;
  name: string;
  priceCents: number;
  /** Menu locale. Optional so a card that hasn't been threaded through
   *  yet still compiles; English is the guaranteed-complete catalogue. */
  locale?: string;
}): React.ReactElement {
  const [justAdded, setJustAdded] = useState(false);
  const t = checkoutCopy(locale);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label={t.addAria(name)}
      onClick={() => {
        addToCart(slug, { itemId, name, priceCents });
        setJustAdded(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setJustAdded(false), 1200);
      }}
      className={
        // Phones get a compact round "+" — the label appears from sm up.
        justAdded
          ? "add-cta inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-[var(--menu-positive)]/60 bg-[var(--menu-positive)]/10 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--menu-positive)] transition sm:h-auto sm:w-auto sm:px-3.5 sm:py-1.5"
          : "add-cta inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-[var(--menu-surface-accent,var(--menu-accent))]/60 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--menu-surface-accent,var(--menu-accent))] transition hover:bg-[var(--menu-accent)] active:scale-90 hover:text-[var(--menu-bg)] sm:h-auto sm:w-auto sm:px-3.5 sm:py-1.5"
      }
    >
      <span aria-hidden="true" className="block text-base leading-none tracking-normal sm:hidden">
        {justAdded ? "✓" : "+"}
      </span>
      <span className="hidden sm:inline">{justAdded ? t.added : t.add}</span>
    </button>
  );
}
