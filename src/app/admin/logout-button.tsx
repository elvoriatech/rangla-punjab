"use client";

import { useRef, useState } from "react";
import { logoutAction } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Admin logout with an in-app "are you sure" dialog — staff sessions
 * are long-lived work contexts, so one stray click shouldn't end one.
 * The button only opens the dialog; the actual logout submits the
 * server-action form via requestSubmit once confirmed.
 */
export function AdminLogoutButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <form ref={formRef} action={logoutAction}>
        <button type="button" onClick={() => setOpen(true)} className={className}>
          Log out
        </button>
      </form>
      <ConfirmDialog
        open={open}
        title="Log out?"
        message="You'll return to the login page. Any form you're mid-way through is lost."
        confirmLabel="Log out"
        onConfirm={() => {
          setOpen(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
