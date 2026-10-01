"use client";

import { useState, useSyncExternalStore, type ComponentPropsWithoutRef } from "react";

const noop = (): (() => void) => () => {};

/**
 * A password field with an eye that reveals what was typed — so a typo is
 * seen before it is submitted (owner, 2026-10-01).
 *
 * The eye is drawn only once the page has hydrated: without JS it could
 * not do anything, and the field underneath is then a plain
 * `type="password"` input that submits exactly as before.
 */
export function PasswordInput({
  className = "",
  wrapperClassName = "",
  showLabel = "Show password",
  hideLabel = "Hide password",
  ...props
}: Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  /** Layout that used to sit on the input (margins, width). */
  wrapperClassName?: string;
  showLabel?: string;
  hideLabel?: string;
}): React.ReactElement {
  const [shown, setShown] = useState(false);
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return (
    <span className={`relative block ${wrapperClassName}`}>
      <input
        {...props}
        type={shown ? "text" : "password"}
        className={`w-full ${hydrated ? "pe-11" : ""} ${className}`}
      />
      {hydrated ? (
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? hideLabel : showLabel}
          aria-pressed={shown}
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
            {shown ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>
      ) : null}
    </span>
  );
}
