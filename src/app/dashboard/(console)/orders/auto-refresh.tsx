"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the server component on an interval so the kitchen sees new
 * orders without touching the screen. Polling is the honest MVP here;
 * push (SSE/WebSocket) is a later upgrade with the same page contract.
 */
export function AutoRefresh({ seconds }: { seconds: number }): null {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
