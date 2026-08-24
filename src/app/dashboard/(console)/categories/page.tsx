import Link from "next/link";
import { FlashMessage } from "@/components/flash-message";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { listCategories } from "@/lib/categories-service";
import { listActiveTemplates } from "@/lib/menu-template-service";
import { ensureDraft, getMenuStatus } from "@/lib/menu-versions-service";
import { asUser } from "@/lib/tenant";
import { signPreviewToken } from "@/lib/preview-token";
import { ApplyTemplateButton } from "./apply-template-button";
import { CategoryPhotoButton } from "./category-photo-button";
import { addCategoryAction, deleteCategoryAction, moveCategoryAction } from "./actions";

/**
 * Categories admin page. Server component: reads the list, renders it, wires
 * server actions. Reorder is exposed as up/down buttons so a no-JS browser
 * can shuffle categories with the same authority the API gives — true drag-
 * and-drop is a UX polish, not a data-model concern (drag-and-drop UI is a
 * follow-up task; the reorder API is the same one it will call).
 */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const base = `/dashboard`;
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const { saved, error } = await searchParams;

  // A restaurant provisioned straight to a published version has no draft
  // yet; fork one from the live menu so the editor has something to open.
  await ensureDraft(userId);
  const list = await listCategories(userId);
  if (!list.ok) {
    // Still no draft ⇒ no menu row at all (not fully provisioned).
    redirect("/dashboard");
  }

  const categories = list.value;
  // Read-only starter templates. Always available: an owner with an empty
  // menu uses them to start; an owner with a menu can switch to a different
  // one at any time (applying replaces the current menu, behind a confirm).
  const templates = await listActiveTemplates();
  const menuHasContent = categories.length > 0;
  const status = await getMenuStatus(userId);

  // Mint a fresh preview token on every page load — TTL is short (1 h) so a
  // page refresh gives the user a fresh URL, and a leaked one dies quickly.
  const venue = await asUser(userId, (tx) =>
    tx.venue.findFirst({ select: { id: true, tenantId: true, slug: true } }),
  );
  const previewUrl = venue ? `/?preview=${signPreviewToken(venue.tenantId, venue.id)}` : null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-brand-cream px-6 py-16 text-brand-green">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-brand-gold">Menu editor</p>
      <h1 className="font-serif text-4xl leading-tight">Categories</h1>
      <p className="mt-2 text-sm text-brand-green/70">
        The order you set here is the order your guests will see.
      </p>

      {saved === "photo" ? (
        <FlashMessage
          kind="success"
          text="Category photo saved. Publish the menu to show it to guests."
        />
      ) : null}
      {error === "photo" ? (
        <FlashMessage
          kind="error"
          text="That photo was not stored — use JPEG, PNG, or WebP up to 10 MB (iPhone HEIC photos are not supported)."
        />
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="min-w-0">
          <section
            aria-label="Publish status"
            className="border border-brand-green/20 bg-white px-4 py-3 text-sm"
          >
            <p className="font-medium">
              {status.publishedAt
                ? `Last published ${new Date(status.publishedAt).toLocaleString()}`
                : "Not published yet"}
            </p>
            <p className="text-xs text-brand-green/60">
              Guests see only what you publish. Draft edits are private until then — use{" "}
              <span className="font-medium">Publish</span> in the sidebar to make them live.
            </p>
          </section>

          {templates.length > 0 ? (
            menuHasContent ? (
              // A menu already exists: templates stay available as a collapsed
              // "switch" panel, so they don't crowd the editor but are one click
              // away. Applying replaces the current menu (confirmed in the tile).
              <details className="mt-8 border border-brand-gold/40 bg-white">
                <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium marker:content-none">
                  <span className="text-brand-gold">⇄</span> Apply a different menu template
                  <span className="mt-1 block text-xs font-normal text-brand-green/70">
                    Replaces your current menu with a fresh copy of the chosen template. Your
                    originals are safe — templates are read-only.
                  </span>
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t border-brand-gold/20 p-5 sm:grid-cols-3">
                  {templates.map((t) => (
                    <ApplyTemplateButton
                      key={t.key}
                      templateKey={t.key}
                      name={t.name}
                      emoji={t.emoji}
                      categoryCount={t.categoryCount}
                      itemCount={t.itemCount}
                      willReplace
                    />
                  ))}
                </div>
              </details>
            ) : (
              <section
                aria-label="Start from a template"
                className="mt-8 border border-brand-gold/40 bg-white p-5"
              >
                <p className="text-sm font-medium">Start from a menu template</p>
                <p className="mt-1 text-xs text-brand-green/70">
                  Pick the closest cuisine and we&apos;ll fill your menu with typical dishes and
                  prices. You can rename, reprice, or remove anything before publishing.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {templates.map((t) => (
                    <ApplyTemplateButton
                      key={t.key}
                      templateKey={t.key}
                      name={t.name}
                      emoji={t.emoji}
                      categoryCount={t.categoryCount}
                      itemCount={t.itemCount}
                      willReplace={false}
                    />
                  ))}
                </div>
              </section>
            )
          ) : null}

          <form
            action={addCategoryAction}
            className="mt-10 border border-brand-green/20 bg-white p-4"
          >
            <div className="flex items-stretch gap-2">
              <label className="sr-only" htmlFor="new-category">
                New category name
              </label>
              <input
                id="new-category"
                name="name"
                required
                maxLength={80}
                placeholder="e.g. Antipasti"
                className="flex-1 border border-brand-green/20 bg-white px-4 py-3 text-base focus:border-brand-green focus:outline-none"
              />
              <button
                type="submit"
                className="bg-brand-green px-5 py-3 text-xs font-medium uppercase tracking-wider text-brand-cream hover:bg-brand-green-dark"
              >
                Add
              </button>
            </div>
            <label className="mt-3 block text-xs text-brand-green/70" htmlFor="new-category-photo">
              Photo (optional) — shown next to the section name on your menu. JPEG, PNG, or WebP up
              to 10&nbsp;MB. Without one, guests see the section number instead.
              <input
                id="new-category-photo"
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-1 block w-full text-sm file:mr-3 file:border file:border-brand-green/30 file:bg-brand-cream file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-wider"
              />
            </label>
          </form>

          <ol className="mt-8 divide-y divide-brand-green/10 border border-brand-green/20 bg-white">
            {categories.length === 0 ? (
              <li className="p-6 text-sm text-brand-green/60">
                No categories yet. Add one above to get started.
              </li>
            ) : (
              categories.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2 px-4 py-3">
                  <span className="w-8 font-serif text-sm text-brand-gold">{i + 1}</span>
                  <CategoryPhotoButton id={c.id} photoKey={c.photoKey} name={c.name} />
                  <Link
                    href={`${base}/categories/${c.id}`}
                    className="flex-1 text-sm hover:underline"
                  >
                    {c.name}
                  </Link>
                  <MoveButton id={c.id} direction="up" disabled={i === 0} />
                  <MoveButton id={c.id} direction="down" disabled={i === categories.length - 1} />
                  <DeleteButton id={c.id} />
                </li>
              ))
            )}
          </ol>
        </div>

        {previewUrl ? (
          <section aria-label="Phone preview" className="lg:sticky lg:top-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-2xl">Phone preview</h2>
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="text-xs uppercase tracking-wider underline"
              >
                Open public menu ↗
              </a>
            </div>
            <p className="mt-1 text-xs text-brand-green/60">
              The frame below shows your <span className="font-medium">draft</span>; the link opens
              the live public menu guests see. Publish to make your draft live.
            </p>
            <div className="mt-4 mx-auto max-w-sm overflow-hidden rounded-2xl border-4 border-brand-green-dark bg-black shadow-2xl">
              <iframe
                src={previewUrl}
                title="Phone preview of the current draft"
                className="block h-[640px] w-full bg-white"
              />
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function MoveButton({
  id,
  direction,
  disabled,
}: {
  id: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <form action={moveCategoryAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={`Move ${direction}`}
        className="border border-brand-green/20 px-2 py-1 text-sm hover:border-brand-green disabled:opacity-30"
      >
        {direction === "up" ? "↑" : "↓"}
      </button>
    </form>
  );
}

function DeleteButton({ id }: { id: string }) {
  return (
    <form action={deleteCategoryAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label="Delete category"
        className="border border-brand-green/20 px-2 py-1 text-sm text-red-700 hover:border-red-700"
      >
        ✕
      </button>
    </form>
  );
}
