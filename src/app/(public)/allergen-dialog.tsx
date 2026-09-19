"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { allergenName } from "@/lib/allergens";
import type { UiLocale } from "@/lib/locales";

/** The six strings this dialog says, resolved for the guest's language by
 *  the server that renders the dish row (P7-16: a client component never
 *  imports a five-locale catalogue). `infoFor` arrives with the dish name
 *  already interpolated. */
export interface AllergenLabels {
  info: string;
  infoFor: string;
  heading: string;
  contains: string;
  traces: string;
  close: string;
}

/**
 * ⚠ allergen disclosure. The trigger chip sits in the dish row; the
 * panel opens as a CENTERED overlay portaled to <body> — dish cards
 * clip overflow and animate with transforms, so any in-card popup gets
 * cut off or trapped behind neighbours. The panel is deliberately
 * theme-neutral (white card) because the portal escapes the menu-theme
 * CSS variables; a fixed light palette stays readable on every theme.
 *
 * The 14 EU allergen names come from `src/lib/allergens.ts` — the same
 * vocabulary the owner dashboard and the kitchen ticket use — so a guest
 * never reads a name this file invented on its own.
 */
export function AllergenDialog({
  allergens,
  traces,
  dishName,
  lang,
  labels,
}: {
  allergens: string[];
  traces: string[];
  dishName: string;
  /** Collapsed UI locale — only used to look the 14 EU allergen names up. */
  lang: UiLocale;
  labels: AllergenLabels;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);

  // Escape closes; page behind stays put while the dialog is up.
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

  if (allergens.length === 0 && traces.length === 0) return null;

  const names = (keys: string[]): string => keys.map((k) => allergenName(k, lang)).join(", ");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={labels.info}
        aria-haspopup="dialog"
        /* Wash, not an outline, and the glyph takes surface ink: accent is
           guaranteed against a surface at 3:1, so a 15px accent ⚠ was short of
           AA on the themes where accent is a pale gold. This chip sits inside a
           dish card, hence surface ink. */
        className="inline-flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-full bg-[var(--menu-surface-accent,var(--menu-accent))]/14 px-1.5 text-[15px] leading-none text-[var(--menu-surface-text,var(--menu-text))] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--menu-surface-text,var(--menu-text))]"
      >
        <span aria-hidden="true">⚠</span>
        <span className="sr-only">{labels.info}</span>
      </button>
      {open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={labels.infoFor}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            >
              <button
                type="button"
                aria-label={labels.close}
                onClick={() => setOpen(false)}
                className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
              />
              <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-neutral-900 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)]">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">
                  ⚠ {labels.heading}
                </p>
                <p className="mt-1 font-serif text-xl leading-snug">{dishName}</p>
                {allergens.length > 0 ? (
                  <>
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                      {labels.contains}
                    </p>
                    <p className="mt-1 text-base leading-relaxed">{names(allergens)}</p>
                  </>
                ) : null}
                {traces.length > 0 ? (
                  <>
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                      {labels.traces}
                    </p>
                    <p className="mt-1 text-base leading-relaxed text-neutral-700">
                      {names(traces)}
                    </p>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-6 w-full rounded-full bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  {labels.close}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
