import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUserId } from "@/lib/auth";
import { adminGetTemplate } from "@/lib/menu-template-service";
import { uploadedImageUrl } from "@/lib/menu-images";
import {
  addCategoryAction,
  addItemAction,
  deleteCategoryAction,
  deleteItemAction,
  importTemplateAction,
  setCategoryImageAction,
  setItemImageAction,
} from "../actions";
import { SequentialImageUploader } from "../../sequential-image-uploader";
import { SubmitButton } from "@/components/submit-button";

/**
 * Template content editor — the admin counterpart to the restaurant
 * menu editor: add categories, add items to each. Mutates the
 * template's content JSON. Same shape of form the owner sees, so what
 * admins author matches what gets cloned.
 */

const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
];
const DIETARY = ["vegetarian", "vegan", "gluten_free", "dairy_free", "halal"];

const field =
  "border border-white/15 bg-admin-surface px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60";
const fileField =
  "text-xs text-neutral-400 file:mr-2 file:border file:border-white/20 file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-neutral-300";

export default async function AdminTemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const template = await adminGetTemplate(userId, id);
  if (!template) notFound();

  const sp = await searchParams;
  const tioNotice =
    sp.tio === "ok"
      ? `Template populated from the file — ${sp.c ?? 0} categories, ${sp.i ?? 0} items.` +
        (Number(sp.w) > 0 ? ` ${sp.w} row(s) skipped.` : "") +
        " (Photos are added below, not from the sheet.)"
      : sp.tio === "err"
        ? `Import failed — couldn't read the file (${sp.n ?? 0} problem(s)).`
        : sp.tio === "nofile"
          ? "No file was selected."
          : sp.tio === "invalid"
            ? "The file didn't match the expected menu format."
            : null;
  const tioError = sp.tio === "err" || sp.tio === "nofile" || sp.tio === "invalid";

  const euro = (cents: number): string =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const itemCount = template.content.categories.reduce((n, c) => n + c.items.length, 0);

  return (
    <main className="px-6 py-10 lg:px-10">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin/templates"
          className="text-xs text-neutral-500 underline-offset-2 hover:text-white hover:underline"
        >
          ← All templates
        </Link>
        <header className="mt-3 flex items-baseline justify-between gap-4">
          <h1 className="font-serif text-3xl text-white">
            <span aria-hidden="true" className="mr-2">
              {template.emoji}
            </span>
            {template.name}
          </h1>
          <span className="text-xs text-neutral-500">
            {template.cuisine} · {template.content.categories.length} categories · {itemCount} items
            {template.active ? "" : " · hidden"}
          </span>
        </header>

        {tioNotice ? (
          <p
            role="status"
            className={
              tioError
                ? "mt-6 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
                : "mt-6 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
            }
          >
            {tioNotice}
          </p>
        ) : null}

        {/* Populate from a spreadsheet — download the format, edit, re-upload. */}
        <section className="mt-6 border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white">Populate from a spreadsheet</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Download the format, fill in dishes, and upload it back to replace this template&apos;s
            content in one go. Photos are added per-item below, not from the sheet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/admin/templates/${template.id}/export?format=xlsx`}
              className="border border-white/15 px-3 py-2 text-xs text-neutral-200 hover:border-admin-accent/50 hover:text-white"
            >
              ⬇ Excel (.xlsx)
            </a>
            <a
              href={`/admin/templates/${template.id}/export?format=json`}
              className="border border-white/15 px-3 py-2 text-xs text-neutral-200 hover:border-admin-accent/50 hover:text-white"
            >
              ⬇ JSON
            </a>
          </div>
          <form action={importTemplateAction} className="mt-4 border-t border-white/10 pt-4">
            <input type="hidden" name="id" value={template.id} />
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Content (Excel / JSON)
            </p>
            <input
              type="file"
              name="file"
              required
              accept=".xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className={`block w-full ${fileField}`}
            />
            <SubmitButton
              pendingLabel="Importing…"
              className="mt-3 bg-admin-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-900 hover:bg-admin-accent disabled:opacity-70"
            >
              Upload &amp; replace content
            </SubmitButton>
          </form>

          <div className="mt-5 border-t border-white/10 pt-4">
            <SequentialImageUploader
              endpoint={`/admin/templates/${template.id}/images`}
              hint={
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Photos (bulk — auto-resized)
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Pick several at once — they upload one at a time. Name each file to match a
                    dish&apos;s <span className="text-neutral-300">Image</span> cell, e.g.{" "}
                    <code className="text-neutral-300">samosa.jpg</code>. Every image is resized;
                    re-uploading the same name replaces it.
                  </p>
                </>
              }
            />
          </div>
        </section>

        {/* Add category */}
        <form action={addCategoryAction} className="mt-8 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={template.id} />
          <label className="min-w-48 flex-1 text-xs text-neutral-400">
            New category
            <input
              name="name"
              required
              placeholder="Starters"
              className={`mt-1 block w-full ${field}`}
            />
          </label>
          <label className="text-xs text-neutral-400">
            Photo (optional)
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              className={`mt-1 block ${fileField}`}
            />
          </label>
          <button
            type="submit"
            className="border border-admin-accent/50 bg-admin-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-admin-accent hover:bg-admin-accent/20"
          >
            + Category
          </button>
        </form>

        {template.content.categories.length === 0 ? (
          <p className="mt-8 border border-white/10 bg-white/[0.02] px-5 py-8 text-center text-sm text-neutral-500">
            No categories yet. Add one above, then add dishes to it.
          </p>
        ) : null}

        {template.content.categories.map((cat, ci) => (
          <section
            key={ci}
            id={`cat-${ci}`}
            className="mt-8 border border-white/10 bg-white/[0.02] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {cat.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={uploadedImageUrl(cat.image.key, 96)}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 border border-white/10 object-cover"
                  />
                ) : null}
                <h2 className="font-serif text-xl text-white">{cat.name}</h2>
              </div>
              <div className="flex items-center gap-4">
                <form action={setCategoryImageAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={template.id} />
                  <input type="hidden" name="categoryIndex" value={ci} />
                  <label className="sr-only" htmlFor={`cat-photo-${ci}`}>
                    Category photo
                  </label>
                  <input
                    id={`cat-photo-${ci}`}
                    type="file"
                    name="photo"
                    required
                    accept="image/jpeg,image/png,image/webp"
                    className={`w-44 ${fileField}`}
                  />
                  <button
                    type="submit"
                    className="border border-white/20 px-2 py-1 text-[11px] uppercase tracking-wider text-neutral-300 hover:border-admin-accent/50 hover:text-white"
                  >
                    {cat.image ? "Replace" : "Set photo"}
                  </button>
                </form>
                <form action={deleteCategoryAction}>
                  <input type="hidden" name="id" value={template.id} />
                  <input type="hidden" name="index" value={ci} />
                  <button
                    type="submit"
                    className="text-xs text-red-400/80 underline-offset-2 hover:text-red-300 hover:underline"
                  >
                    Delete category
                  </button>
                </form>
              </div>
            </div>

            {/* Existing items */}
            <ul className="mt-3 divide-y divide-white/5">
              {cat.items.map((item, ii) => (
                <li key={ii} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={uploadedImageUrl(item.image.key, 80)}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 shrink-0 border border-white/10 object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center border border-dashed border-white/15 text-[10px] text-neutral-600"
                      >
                        no img
                      </span>
                    )}
                    <span className="min-w-0 text-white">
                      {item.name}
                      {item.spice > 0 ? (
                        <span className="ml-1 text-red-300">{"🌶".repeat(item.spice)}</span>
                      ) : null}
                      {item.dietary.length > 0 || item.allergens.length > 0 ? (
                        <span className="ml-2 text-xs text-neutral-500">
                          {[...item.dietary, ...item.allergens.map((a) => `+${a}`)].join(", ")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <form action={setItemImageAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={template.id} />
                      <input type="hidden" name="categoryIndex" value={ci} />
                      <input type="hidden" name="itemIndex" value={ii} />
                      <label className="sr-only" htmlFor={`item-photo-${ci}-${ii}`}>
                        Photo for {item.name}
                      </label>
                      <input
                        id={`item-photo-${ci}-${ii}`}
                        type="file"
                        name="photo"
                        required
                        accept="image/jpeg,image/png,image/webp"
                        className={`w-40 ${fileField}`}
                      />
                      <button
                        type="submit"
                        className="border border-white/20 px-2 py-1 text-[11px] uppercase tracking-wider text-neutral-300 hover:border-admin-accent/50 hover:text-white"
                      >
                        {item.image ? "Replace" : "Set"}
                      </button>
                    </form>
                    <span className="tabular-nums text-neutral-300">{euro(item.priceCents)}</span>
                    <form action={deleteItemAction}>
                      <input type="hidden" name="id" value={template.id} />
                      <input type="hidden" name="categoryIndex" value={ci} />
                      <input type="hidden" name="itemIndex" value={ii} />
                      <button
                        type="submit"
                        className="text-xs text-red-400/70 underline-offset-2 hover:text-red-300 hover:underline"
                      >
                        remove
                      </button>
                    </form>
                  </span>
                </li>
              ))}
              {cat.items.length === 0 ? (
                <li className="py-2 text-xs text-neutral-600">No dishes yet.</li>
              ) : null}
            </ul>

            {/* Add item */}
            <form action={addItemAction} className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <input type="hidden" name="id" value={template.id} />
              <input type="hidden" name="categoryIndex" value={ci} />
              <div className="flex flex-wrap gap-3">
                <label className="flex-1 text-xs text-neutral-400">
                  Dish name
                  <input
                    name="name"
                    required
                    placeholder="Bruschetta"
                    className={`mt-1 block w-full ${field}`}
                  />
                </label>
                <label className="w-28 text-xs text-neutral-400">
                  Price (€)
                  <input
                    name="priceEuros"
                    required
                    inputMode="decimal"
                    placeholder="6.90"
                    className={`mt-1 block w-full ${field}`}
                  />
                </label>
                <label className="w-24 text-xs text-neutral-400">
                  Spice 0–3
                  <input
                    name="spice"
                    type="number"
                    min={0}
                    max={3}
                    defaultValue={0}
                    className={`mt-1 block w-full ${field}`}
                  />
                </label>
              </div>
              <label className="block text-xs text-neutral-400">
                Description
                <input
                  name="description"
                  placeholder="Short description (optional)"
                  className={`mt-1 block w-full ${field}`}
                />
              </label>
              <label className="block text-xs text-neutral-400">
                Photo (optional — JPEG/PNG/WebP)
                <input
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/webp"
                  className={`mt-1 block ${fileField}`}
                />
              </label>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-300">
                <span className="w-full text-[11px] uppercase tracking-wider text-neutral-500">
                  Dietary
                </span>
                {DIETARY.map((d) => (
                  <label key={d} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="dietary"
                      value={d}
                      className="accent-admin-accent"
                    />
                    {d.replace("_", "-")}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-400">
                <span className="w-full text-[11px] uppercase tracking-wider text-neutral-500">
                  Allergens (EU 14)
                </span>
                {ALLERGENS.map((a) => (
                  <label key={a} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="allergens"
                      value={a}
                      className="accent-admin-accent"
                    />
                    {a}
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className="border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-200 hover:border-admin-accent/50 hover:text-white"
              >
                + Add dish
              </button>
            </form>
          </section>
        ))}
      </div>
    </main>
  );
}
