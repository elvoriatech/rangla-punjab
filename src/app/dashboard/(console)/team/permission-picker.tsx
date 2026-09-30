"use client";

import { useState } from "react";
import { PERMISSIONS, PERMISSION_LABELS, PRESETS, type Permission } from "@/lib/team-permissions";

/**
 * The ticked areas for one team member, as `perm` checkboxes inside the
 * surrounding form. "Manager" and "Staff" are only starting points: they
 * set the boxes, and the owner can tick or untick any of them after.
 */
export function PermissionPicker({
  initial,
  idPrefix,
}: {
  initial: readonly Permission[];
  idPrefix: string;
}): React.ReactElement {
  const [chosen, setChosen] = useState<Set<Permission>>(new Set(initial));
  const apply = (preset: keyof typeof PRESETS): void => setChosen(new Set(PRESETS[preset]));
  const toggle = (p: Permission): void =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <fieldset className="mt-4">
      <legend className="text-xs uppercase tracking-[0.2em] text-gold-dark">Access</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => apply("manager")}
          className="border border-ink/25 px-3 py-1.5 text-xs font-semibold hover:border-ink/60"
        >
          Manager preset
        </button>
        <button
          type="button"
          onClick={() => apply("staff")}
          className="border border-ink/25 px-3 py-1.5 text-xs font-semibold hover:border-ink/60"
        >
          Staff preset
        </button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {PERMISSIONS.map((p) => {
          const id = `${idPrefix}-${p}`;
          return (
            <li key={p}>
              <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  name="perm"
                  value={p}
                  checked={chosen.has(p)}
                  onChange={() => toggle(p)}
                  className="mt-0.5 h-4 w-4 accent-[#8f1a1a]"
                />
                <span>
                  <span className="font-semibold">{PERMISSION_LABELS[p].label}</span>
                  <span className="block text-xs text-muted">{PERMISSION_LABELS[p].hint}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
