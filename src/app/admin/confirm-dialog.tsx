"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * In-app confirmation dialog for the admin console — replaces native
 * window.confirm() so destructive actions get a designed, readable
 * prompt. Zero dependencies, portal'd to <body> so it floats above any
 * layout chrome. Escape and the backdrop both cancel; nothing happens
 * without an explicit click on the confirm button.
 *
 * Admin-only by location: guest routes never import this, so the QR
 * menu bundle is untouched.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red styling for irreversible actions. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
      />
      <div className="relative w-full max-w-sm border border-white/15 bg-[#171a21] p-6 text-neutral-200 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.8)]">
        <h2 className="font-serif text-xl text-white">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-neutral-400">{message}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="border border-white/20 px-4 py-2 text-xs uppercase tracking-wider text-neutral-300 hover:border-white/50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? "border border-red-500/70 bg-red-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-red-300 hover:bg-red-500/30"
                : "border border-admin-accent/60 bg-admin-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-admin-accent hover:bg-admin-accent/20"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
