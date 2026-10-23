"use client";

import { useEffect } from "react";
import { recordDashboardPrintAction } from "./actions";

/**
 * `auto` fires the print dialog as soon as the ticket renders — a Print
 * button, or an automatic print the server allowed (first print of the
 * order on any device). Without it the page is a quiet preview whose own
 * Print button records the print when pressed.
 */
export function PrintControls({
  auto,
  orderId,
  recordOnPrint,
}: {
  auto: boolean;
  orderId: string;
  /** "View order" page: record the print when its Print button is pressed. */
  recordOnPrint: boolean;
}): React.ReactElement {
  useEffect(() => {
    if (auto) window.print();
  }, [auto]);

  return (
    <div className="mt-6 flex justify-center gap-3 print:hidden">
      <button
        type="button"
        onClick={() => {
          if (recordOnPrint) void recordDashboardPrintAction(orderId);
          window.print();
        }}
        className="bg-black px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white hover:bg-black/80"
      >
        Print
      </button>
      <button
        type="button"
        onClick={() => window.close()}
        className="border border-black/30 px-5 py-2 text-xs uppercase tracking-[0.18em] text-black/60 hover:border-black"
      >
        Close
      </button>
    </div>
  );
}
