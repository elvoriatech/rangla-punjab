"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Chrome / Edge / Android's deferred install prompt (not in lib.dom). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallLabels {
  label: string;
  aria: string;
  iosHint: string;
  macHint: string;
  close: string;
}

type Mode = "prompt" | "ios" | "mac";

const noop = (): (() => void) => () => {};

/** Safari never fires `beforeinstallprompt`; it installs from its own menu. */
function detectPlatform(): "installed" | "ios" | "mac" | "none" {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/.test(ua);
  return safari && /Macintosh/.test(ua) ? "mac" : "none";
}

/**
 * "Install" — puts the WEBSITE on the device as an app (owner,
 * 2026-10-01): its own icon and window on Windows, macOS, Android and
 * iOS, from the manifest at `/menu.webmanifest`.
 *
 * Renders nothing until the browser can actually do it, so the no-JS
 * page and browsers without an install path are unchanged:
 *  - Chrome / Edge / Android fire `beforeinstallprompt`; the chip opens
 *    the browser's own install dialog.
 *  - Safari has no such event. On iPhone/iPad and on a Mac the chip
 *    opens a short note saying where Safari keeps the command.
 * Already installed (running standalone) ⇒ nothing. No storage is
 * touched: the chip is small enough to stay, so nothing needs dismissing.
 */
export function InstallAppButton({
  labels,
  onDark = false,
}: {
  labels: InstallLabels;
  onDark?: boolean;
}): React.ReactElement | null {
  const [canPrompt, setCanPrompt] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const deferred = useRef<InstallPromptEvent | null>(null);
  // What this browser offers WITHOUT the event — read once on the client;
  // the server snapshot is "nothing", so the no-JS page stays as it was.
  const platform = useSyncExternalStore(noop, detectPlatform, () => "none" as const);

  useEffect(() => {
    const onPrompt = (event: Event): void => {
      event.preventDefault();
      deferred.current = event as InstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = (): void => {
      deferred.current = null;
      setCanPrompt(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const mode: Mode | null =
    platform === "installed"
      ? null
      : canPrompt
        ? "prompt"
        : platform === "ios" || platform === "mac"
          ? platform
          : null;

  useEffect(() => {
    if (!hintOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setHintOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hintOpen]);

  if (!mode) return null;

  const onClick = async (): Promise<void> => {
    const event = deferred.current;
    if (mode === "prompt" && event) {
      await event.prompt();
      await event.userChoice;
      // The event is single-use; hide the chip once it has been spent.
      deferred.current = null;
      setCanPrompt(false);
      return;
    }
    setHintOpen((v) => !v);
  };

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => void onClick()}
        aria-label={labels.aria}
        aria-expanded={mode === "prompt" ? undefined : hintOpen}
        className={`inline-flex min-h-6 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
          onDark
            ? "border-white/40 bg-black/45 text-white backdrop-blur"
            : "border-[var(--menu-text)]/25 text-[var(--menu-text)]/85 hover:border-[var(--menu-text)]/50"
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 4v11" />
          <path d="M7 11l5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
        {labels.label}
      </button>
      {hintOpen && mode !== "prompt" ? (
        <span
          role="dialog"
          aria-label={labels.aria}
          className="absolute end-0 top-full z-30 mt-2 flex w-64 max-w-[80vw] items-start gap-2 rounded-lg border border-black/10 bg-white p-3 text-start text-xs leading-snug text-neutral-900 shadow-lg"
        >
          <span className="flex-1">{mode === "ios" ? labels.iosHint : labels.macHint}</span>
          <button
            type="button"
            onClick={() => setHintOpen(false)}
            aria-label={labels.close}
            className="-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-600 hover:text-neutral-900"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </span>
      ) : null}
    </span>
  );
}
