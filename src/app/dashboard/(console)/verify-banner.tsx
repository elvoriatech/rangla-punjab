"use client";

import { useState } from "react";

/**
 * Slim nudge shown across the dashboard until the owner verifies their
 * email. Signup deliberately does NOT block on verification (a hot lead
 * should reach their menu in two minutes) — but password recovery and
 * order notifications depend on a reachable address, so we keep asking.
 * Resend reuses the public request endpoint, which never leaks whether
 * an address exists.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-700/25 bg-amber-100 px-4 py-2 text-xs text-amber-900"
    >
      <span>
        ✉ Please confirm your email — we sent a link to <strong>{email}</strong>. You need it for
        password recovery and order notifications.
      </span>
      <button
        type="button"
        disabled={state !== "idle"}
        onClick={async () => {
          setState("sending");
          try {
            await fetch("/api/auth/verify/request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            setState("sent");
          } catch {
            setState("idle");
          }
        }}
        className="font-semibold underline underline-offset-2 disabled:opacity-60"
      >
        {state === "sent"
          ? "Sent ✓ — check your inbox"
          : state === "sending"
            ? "Sending…"
            : "Resend the email"}
      </button>
    </div>
  );
}
