"use client";

import { useEffect } from "react";

/**
 * Keeps the tablet screen awake while the kitchen board is open, via the
 * Screen Wake Lock API. The lock is silently dropped by the browser when
 * the tab hides — we re-acquire on visibilitychange. No-ops where the
 * API is missing.
 */
export function WakeLock(): null {
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async (): Promise<void> => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          sentinel = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Unsupported or denied (e.g. battery saver) — the board still works.
      }
    };

    void acquire();
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  return null;
}
