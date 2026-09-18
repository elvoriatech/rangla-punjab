"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "./submit-button";

/**
 * A submit button for "settings" forms that stays disabled until the user
 * actually changes something. Settings pages redirect back to themselves
 * after saving, so a freshly loaded form is pristine by definition; a
 * disabled Save is how the owner can tell "already saved" from "not yet".
 *
 * Dirtiness is tracked on the enclosing <form> (typing, toggling, picking a
 * select option) — no controlled inputs needed, so the server-action forms
 * keep working exactly as before, and a browser `reset` puts it back.
 */
export function SaveChangesButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}): React.ReactElement {
  const ref = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const markDirty = (): void => setDirty(true);
    const markClean = (): void => setDirty(false);
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    form.addEventListener("reset", markClean);
    return () => {
      form.removeEventListener("input", markDirty);
      form.removeEventListener("change", markDirty);
      form.removeEventListener("reset", markClean);
    };
  }, []);

  return (
    <SubmitButton
      ref={ref}
      pendingLabel={pendingLabel}
      className={className}
      disabled={!dirty}
      title={dirty ? undefined : "Nothing to save yet — change a field first"}
    >
      {children}
    </SubmitButton>
  );
}
