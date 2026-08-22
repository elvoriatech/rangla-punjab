"use client";

import { useEffect, useState } from "react";

/**
 * Floating message popup — the one way user-facing feedback appears
 * across the app (dashboard, admin, auth, account). Replaces the old
 * inline banners so a save/error never gets lost below the fold.
 *
 * Success messages dismiss themselves; errors stay until closed so a
 * failure is never missed. Colors signal with fills, not borders, per
 * the app's visual language. Without JS the popup simply renders
 * visible and static — content is never lost.
 */
export function MessagePopup({
  kind,
  text,
  autoHideMs,
}: {
  kind: "success" | "error";
  text: string;
  /** Override the auto-dismiss delay; errors never auto-dismiss. */
  autoHideMs?: number;
}): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const [entered, setEntered] = useState(false);

  // Re-open when a new message arrives on the same mounted popup —
  // derived-state-during-render, the React-sanctioned reset pattern.
  const [prev, setPrev] = useState({ kind, text });
  if (prev.kind !== kind || prev.text !== text) {
    setPrev({ kind, text });
    setOpen(true);
  }

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (kind === "error") return;
    const t = setTimeout(() => setOpen(false), autoHideMs ?? 6000);
    return () => clearTimeout(t);
  }, [kind, text, autoHideMs]);

  if (!open) return null;

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md px-5 py-3.5 text-sm shadow-lg transition-[opacity,transform] duration-300 motion-reduce:transition-none sm:max-w-md ${
        entered ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      } ${kind === "error" ? "bg-red-800 text-red-50" : "bg-emerald-800 text-emerald-50"}`}
    >
      <span aria-hidden="true" className="mt-0.5 text-base leading-none">
        {kind === "error" ? "⚠" : "✓"}
      </span>
      <span className="min-w-0 break-words">{text}</span>
      <button
        type="button"
        aria-label="Dismiss message"
        onClick={() => setOpen(false)}
        className="ml-1 -mr-1 -mt-0.5 rounded p-1 text-lg leading-none opacity-80 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
      >
        ×
      </button>
    </div>
  );
}
