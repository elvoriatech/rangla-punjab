"use client";

import { useRef, useState } from "react";
import { purgeTenantAction } from "../../actions";
import { ConfirmDialog } from "../../confirm-dialog";

/**
 * "Delete permanently" — the point of no return, so it demands an
 * explicit in-app confirm dialog on top of the soft-delete that must
 * already have happened. Names the restaurant in the prompt so nobody
 * purges the wrong tenant from muscle memory.
 */
export function PurgeTenantButton({ tenantId, name }: { tenantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <form ref={formRef} action={purgeTenantAction}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border border-red-500/70 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-red-300 hover:bg-red-500/25"
        >
          ⚠ Delete permanently
        </button>
      </form>
      <ConfirmDialog
        open={open}
        danger
        title="Delete permanently?"
        message={
          <>
            <span className="text-neutral-200">“{name}”</span> and <strong>all</strong> of its data
            will be erased — menus, orders, photos, and the owner&apos;s account.{" "}
            <strong className="text-red-300">This cannot be undone.</strong>
          </>
        }
        confirmLabel="Delete everything"
        onConfirm={() => {
          setOpen(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
