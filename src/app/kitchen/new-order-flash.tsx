"use client";

import { useEffect, useRef } from "react";

/**
 * Blinks the *newly arrived* ticket(s) — not the whole screen. Persists across
 * the board's 7s refreshes (client component ⇒ router.refresh keeps its state),
 * tracking which order IDs it has already seen. When new IDs appear, it adds the
 * `kds-card-flash` class to just those cards (matched by `data-order-id`) for a
 * ~2s glow, then removes it. First render seeds "seen" so existing orders on
 * load don't blink.
 */
export function NewOrderFlash({ orderIds }: { orderIds: string[] }): null {
  const seen = useRef<Set<string> | null>(null);
  const key = orderIds.join(",");

  useEffect(() => {
    if (seen.current === null) {
      // First mount: remember what's already on the board, don't flash it.
      seen.current = new Set(orderIds);
      return;
    }
    const fresh = orderIds.filter((id) => !seen.current!.has(id));
    orderIds.forEach((id) => seen.current!.add(id));
    if (fresh.length === 0) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of fresh) {
      const el = document.querySelector<HTMLElement>(`[data-order-id="${id}"]`);
      if (!el) continue;
      // Restart the animation if it's somehow still applied.
      el.classList.remove("kds-card-flash");
      void el.offsetWidth;
      el.classList.add("kds-card-flash");
      timers.push(setTimeout(() => el.classList.remove("kds-card-flash"), 2100));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
