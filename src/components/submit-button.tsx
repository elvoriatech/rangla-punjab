"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that reflects the enclosing form's pending state: while the
 * server action runs it shows a spinner + `pendingLabel` and disables itself,
 * so slow actions (imports, provisioning, email broadcasts) don't look
 * unresponsive. Must be rendered inside a <form action={...}>.
 */
export function SubmitButton({
  children,
  pendingLabel = "Working…",
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}): React.ReactElement {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
            />
          </svg>
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
