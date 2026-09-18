"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { menuCopy } from "@/lib/i18n/menu";

/**
 * Dish description, two lines by default. Long texts are clamped and get a
 * "More" button (in the guest's language) that opens the full text in a centred popup (same
 * portal + neutral-card pattern as the allergen dialog, and for the same
 * reason: dish cards clip and transform, so an in-card expansion would be
 * cut off).
 *
 * Progressive: the server renders the FULL text and the clamp is applied
 * only after hydration, so a no-JS reader loses nothing. The button shows
 * only when the text actually overflows two lines, measured — a short
 * description never grows a pointless "More".
 */
export function DishDescription({
  text,
  dishName,
  locale,
  className,
}: {
  text: string;
  dishName: string;
  locale: string;
  className: string;
}): React.ReactElement {
  const ref = useRef<HTMLParagraphElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);
  const t = menuCopy(locale);

  useEffect(() => {
    // Deferred a tick (react-hooks forbids synchronous setState in effects).
    const id = setTimeout(() => setHydrated(true), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const el = ref.current;
    if (!el) return;
    const check = (): void => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hydrated, text]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <p ref={ref} className={className + (hydrated ? " line-clamp-2" : "")}>
        {text}
      </p>
      {overflows ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={t.dish.moreAbout(dishName)}
          className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold text-[var(--menu-surface-accent,var(--menu-accent))] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-text,var(--menu-text))]"
        >
          {t.dish.more}
          {/* Directional glyph: mirrored under `dir="rtl"` so it still
              points away from the label instead of back into it. */}
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
            ›
          </span>
        </button>
      ) : null}
      {open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={dishName}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            >
              <button
                type="button"
                aria-label={t.dish.close}
                onClick={() => setOpen(false)}
                className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
              />
              <div className="relative max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 text-neutral-900 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)]">
                <p className="font-serif text-xl leading-snug">{dishName}</p>
                <p className="mt-3 text-base leading-relaxed text-neutral-700">{text}</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-6 w-full rounded-full bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  {t.dish.close}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
