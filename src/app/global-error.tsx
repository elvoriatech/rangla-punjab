"use client";

import { useEffect } from "react";
import { isStaleBuildError } from "@/lib/stale-build";

/** Last resort when the root layout itself failed. Same one-shot reload for
 *  stale builds; otherwise a minimal, dependency-free page. */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}): React.ReactElement {
  useEffect(() => {
    if (!isStaleBuildError(error.message)) return;
    const key = `stale-reload:${error.digest ?? error.message.slice(0, 40)}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // ignore
    }
    window.location.reload();
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "Georgia, serif", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: 24 }}>This page couldn&apos;t load.</h1>
        <p style={{ color: "#555" }}>Code: {error.digest ?? "no-digest"}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            padding: "10px 20px",
            borderRadius: 999,
            border: 0,
            background: "#111",
            color: "#fff",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
