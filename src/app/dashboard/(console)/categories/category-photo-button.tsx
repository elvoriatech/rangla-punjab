"use client";

import { useRef, useTransition } from "react";
import { setCategoryPhotoAction } from "./actions";
import { uploadedImageUrl } from "@/lib/menu-images";

/**
 * The category row's photo circle doubles as the upload control: click,
 * pick an image, and it saves immediately — no separate edit screen for
 * something owners do once per category. Photos land on the DRAFT; the
 * guest menu shows them after Publish.
 */
export function CategoryPhotoButton({
  id,
  photoKey,
  name,
}: {
  id: string;
  photoKey: string | null;
  name: string;
}): React.ReactElement {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) => startTransition(() => setCategoryPhotoAction(fd))}
      className="shrink-0"
    >
      <input type="hidden" name="id" value={id} />
      <label
        className="block cursor-pointer"
        title={photoKey ? `Foto für „${name}“ ersetzen` : `Foto für „${name}“ hochladen`}
      >
        {photoKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={uploadedImageUrl(photoKey, 96)}
            alt=""
            className={`h-9 w-9 rounded-full border border-brand-green/20 object-cover ${pending ? "opacity-40" : "hover:ring-2 hover:ring-brand-gold/60"}`}
          />
        ) : (
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-brand-green/30 text-center text-[9px] font-semibold uppercase leading-tight text-brand-green/50 ${pending ? "opacity-40" : "hover:border-brand-gold hover:text-brand-green"}`}
          >
            {pending ? "…" : "+ Foto"}
          </span>
        )}
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          disabled={pending}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) formRef.current?.requestSubmit();
          }}
        />
      </label>
    </form>
  );
}
