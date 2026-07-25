"use client";

import { useRef, useState } from "react";
import { deleteTemplateAction } from "./actions";
import { ConfirmDialog } from "../confirm-dialog";

/**
 * Permanently delete a template, behind a confirm. Safe because applying a
 * template copies its content — no restaurant menu references the row.
 */
export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <form ref={formRef} action={deleteTemplateAction} className="inline">
        <input type="hidden" name="id" value={id} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border border-red-500/50 px-2.5 py-1 text-[11px] uppercase tracking-wider text-red-300 hover:bg-red-500/15"
        >
          Delete
        </button>
      </form>
      <ConfirmDialog
        open={open}
        danger
        title="Delete this template?"
        message={
          <>
            <span className="text-neutral-200">“{name}”</span> will be removed permanently.
            Restaurants that already applied it keep their menus — templates are copied on apply.
          </>
        }
        confirmLabel="Delete template"
        onConfirm={() => {
          setOpen(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
