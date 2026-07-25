"use client";

import { useEffect } from "react";

/**
 * `auto` fires the print dialog as soon as the ticket renders — used by
 * the Print buttons and by the hidden auto-print iframes on the Orders
 * page. Without `auto` the page is a quiet preview with a manual button.
 */
export function PrintControls({ auto }: { auto: boolean }): React.ReactElement {
  useEffect(() => {
    if (auto) window.print();
  }, [auto]);

  return (
    <div className="mt-6 flex justify-center gap-3 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
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
