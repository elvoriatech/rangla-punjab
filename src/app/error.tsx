"use client";

import { useEffect } from "react";
import { isStaleBuildError } from "@/lib/stale-build";

/**
 * Root error boundary. Two jobs:
 *  1. A stale-build error (tab older than the server after a deploy) is
 *     reloaded ONCE automatically — that is the whole fix, no human needed.
 *     A sessionStorage flag keyed on the digest stops a reload loop if the
 *     fresh page fails the same way.
 *  2. Anything else gets a plain card with the digest (what to quote when
 *     reporting it) and Reload / Back — instead of Next's bare default.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  // Derived, not state: the copy below switches on it during render, and
  // the effect only performs the reload (no setState inside an effect).
  const reloading = isStaleBuildError(error.message);

  useEffect(() => {
    if (!reloading) return;
    const key = `stale-reload:${error.digest ?? error.message.slice(0, 40)}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // storage blocked — still worth one reload attempt
    }
    window.location.reload();
  }, [error, reloading]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">
        {reloading ? "Updating" : "Something went wrong"}
      </p>
      <h1 className="mt-2 font-serif text-2xl leading-tight">
        {reloading ? "A new version was just released — reloading…" : "This page couldn't load."}
      </h1>
      {!reloading ? (
        <>
          <p className="mt-3 text-sm text-neutral-600">
            Reload to try again, or go back. If it keeps happening, quote this code:{" "}
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
              {error.digest ?? "no-digest"}
            </code>
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:bg-neutral-100"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => history.back()}
              className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:bg-neutral-100"
            >
              Back
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}
