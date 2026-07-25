"use client";

import { useState } from "react";
import { applyTemplateAction } from "./actions";

/**
 * A template tile. When the restaurant already has a menu, applying a
 * template REPLACES it (applyTemplateToDraft clears the draft first), so we
 * gate it behind a confirmation dialog. On an empty menu there's nothing to
 * lose, so the tile applies straight away. Dashboard-only, so client JS is
 * fine (the no-JS rule is for public pages).
 *
 * Applying clones the whole template tree and copies its photos, which takes
 * a moment — so the submit shows a spinner + disabled state until the server
 * action redirects back.
 */

function Spinner(): React.ReactElement {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function ApplyTemplateButton({
  templateKey,
  name,
  emoji,
  categoryCount,
  itemCount,
  willReplace,
}: {
  templateKey: string;
  name: string;
  emoji: string;
  categoryCount: number;
  itemCount: number;
  willReplace: boolean;
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const tile = (
    <span className="flex w-full flex-col items-start gap-1 border border-brand-green/20 bg-brand-cream px-3 py-3 text-left transition-colors hover:border-brand-gold">
      <span className="text-2xl" aria-hidden="true">
        {emoji}
      </span>
      <span className="text-sm font-medium leading-tight">{name}</span>
      <span className="text-[11px] text-brand-green/60">
        {categoryCount} categories · {itemCount} dishes
      </span>
    </span>
  );

  if (!willReplace) {
    // Empty menu: apply immediately, with an "Applying…" overlay on the tile.
    return (
      <form action={applyTemplateAction} onSubmit={() => setSubmitting(true)}>
        <input type="hidden" name="templateKey" value={templateKey} />
        <button type="submit" disabled={submitting} className="relative block w-full text-left">
          {tile}
          {submitting ? (
            <span className="absolute inset-0 flex items-center justify-center gap-2 bg-brand-cream/85 text-sm font-medium text-brand-green">
              <Spinner /> Applying…
            </span>
          ) : null}
        </button>
      </form>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className="block w-full">
        {tile}
      </button>

      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="replace-menu-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md border border-brand-green/20 bg-white p-6 shadow-xl">
            <h2 id="replace-menu-title" className="font-serif text-xl text-brand-green">
              Replace your menu?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-green/80">
              Applying the <span className="font-medium">{name}</span> template will replace your
              current menu. Any unsaved changes will be lost. Do you want to continue?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={submitting}
                className="border border-brand-green/25 px-4 py-2 text-xs font-medium uppercase tracking-wider text-brand-green hover:bg-brand-cream disabled:opacity-40"
              >
                Cancel
              </button>
              <form action={applyTemplateAction} onSubmit={() => setSubmitting(true)}>
                <input type="hidden" name="templateKey" value={templateKey} />
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 bg-red-700 px-4 py-2 text-xs font-medium uppercase tracking-wider text-white hover:bg-red-800 disabled:opacity-90"
                >
                  {submitting ? (
                    <>
                      <Spinner /> Replacing…
                    </>
                  ) : (
                    "Replace menu"
                  )}
                </button>
              </form>
            </div>
            {submitting ? (
              <p className="mt-3 text-right text-xs text-brand-green/60">
                Copying the template into your menu — this can take a few seconds.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
