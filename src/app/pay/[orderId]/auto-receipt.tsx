"use client";

import { useEffect, useRef } from "react";

/**
 * Once an online payment has settled, hand the guest their receipt
 * without another tap: a hidden anchor with `download` is clicked on
 * mount. Browsers that refuse a non-gesture download (some iOS builds)
 * simply do nothing, which is why the visible button stays.
 */
export function AutoReceipt({
  href,
  filename,
  label,
}: {
  href: string;
  filename: string;
  /** Already localised by the page — this component holds no copy. */
  label: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const id = setTimeout(() => ref.current?.click(), 600);
    return () => clearTimeout(id);
  }, []);
  return (
    <>
      <a ref={ref} href={href} download={filename} className="hidden" aria-hidden="true" />
      <a
        href={href}
        download={filename}
        className="mt-3 inline-block text-sm text-orange-dark underline underline-offset-2"
      >
        {label}
      </a>
    </>
  );
}
