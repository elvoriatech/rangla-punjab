"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  document.addEventListener("fullscreenchange", callback);
  return () => document.removeEventListener("fullscreenchange", callback);
}

/** Toggles browser fullscreen for the kitchen display. Renders always
 *  and no-ops gracefully where the Fullscreen API is missing — every
 *  modern tablet browser has it. */
export function FullscreenButton(): React.ReactElement {
  const active = useSyncExternalStore(
    subscribe,
    () => !!document.fullscreenElement,
    () => false,
  );

  return (
    <button
      type="button"
      onClick={() => {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen?.();
        }
      }}
      className="rounded-md border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/80 transition-colors hover:border-white/50 hover:text-white"
    >
      {active ? "Exit full screen" : "Full screen"}
    </button>
  );
}
