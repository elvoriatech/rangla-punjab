"use client";

import { useEffect, useRef, useState } from "react";
import { addToCart } from "./cart-store";

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
}: {
  slug: string;
  itemId: string;
  name: string;
  priceCents: number;
}): React.ReactElement {
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label={`Add ${name} to order`}
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
          : "add-cta inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-[var(--menu-accent)]/60 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--menu-accent)] transition hover:bg-[var(--menu-accent)] active:scale-90 hover:text-[var(--menu-bg)] sm:h-auto sm:w-auto sm:px-3.5 sm:py-1.5"
      }
    >
      <span aria-hidden="true" className="block text-base leading-none tracking-normal sm:hidden">
        {justAdded ? "✓" : "+"}
      </span>
      <span className="hidden sm:inline">{justAdded ? "Added ✓" : "+ Add"}</span>
    </button>
  );
}
