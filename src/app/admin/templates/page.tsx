import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { adminListTemplates } from "@/lib/menu-template-service";
import { setTemplateActiveAction } from "../actions";
import { createTemplateAction } from "./actions";
import { DeleteTemplateButton } from "./delete-template-button";
import Link from "next/link";

/**
 * Menu templates — the starter menus owners can clone during setup.
 * v1 is manage-visibility: activate/deactivate which cuisines are
 * offered. Content is seeded (scripts/seed-menu-templates.ts); a full
 * editor is a later task.
 */
export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const templates = await adminListTemplates(userId);
  if (!templates) notFound();
  const { saved, error } = await searchParams;
  const activeCount = templates.filter((t) => t.active).length;

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="mx-auto max-w-4xl">
        <h1 className="font-serif text-3xl text-white">Menu templates</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Starter menus owners clone during setup. {activeCount} of {templates.length} active.
          Content is seeded; editing content is a later task.
        </p>
      </header>

      {saved ? (
        <p
          role="status"
          className="mx-auto mt-6 max-w-4xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          Updated. Owners see the change on their next menu-editor visit.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mx-auto mt-6 max-w-4xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error === "duplicate_key"
            ? "That key is already taken — pick another."
            : "Check the fields (key: lowercase letters, numbers, dashes) and try again."}
        </p>
      ) : null}

      <form
        action={createTemplateAction}
        className="mx-auto mt-8 flex max-w-4xl flex-wrap items-end gap-3 border border-white/10 bg-white/[0.03] p-5"
      >
        <label className="text-xs text-neutral-400">
          Emoji
          <input
            name="emoji"
            defaultValue="🍽"
            maxLength={8}
            className="mt-1 block w-16 border border-white/15 bg-admin-surface px-2 py-2 text-center text-sm text-white outline-none focus:border-admin-accent/60"
          />
        </label>
        <label className="flex-1 text-xs text-neutral-400">
          Name
          <input
            name="name"
            required
            placeholder="Mexican"
            className="mt-1 block w-full border border-white/15 bg-admin-surface px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60"
          />
        </label>
        <label className="flex-1 text-xs text-neutral-400">
          Cuisine
          <input
            name="cuisine"
            required
            placeholder="Mexican / Tacos"
            className="mt-1 block w-full border border-white/15 bg-admin-surface px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60"
          />
        </label>
        <label className="flex-1 text-xs text-neutral-400">
          Key (URL id)
          <input
            name="key"
            required
            placeholder="mexican"
            className="mt-1 block w-full border border-white/15 bg-admin-surface px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60"
          />
        </label>
        <button
          type="submit"
          className="border border-admin-accent/50 bg-admin-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-admin-accent hover:bg-admin-accent/20"
        >
          + New template
        </button>
      </form>

      <section aria-label="Templates" className="mx-auto mt-8 max-w-4xl overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              <th className="py-3 pr-4 font-medium">Template</th>
              <th className="py-3 pr-4 font-medium">Cuisine</th>
              <th className="py-3 pr-4 text-right font-medium">Content</th>
              <th className="py-3 pr-4 font-medium">Status</th>
              <th className="py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-white/5">
                <td className="py-3 pr-4 text-white">
                  <Link
                    href={`/admin/templates/${t.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    <span aria-hidden="true" className="mr-2">
                      {t.emoji}
                    </span>
                    {t.name}
                  </Link>
                </td>
                <td className="py-3 pr-4 text-neutral-400">{t.cuisine}</td>
                <td className="py-3 pr-4 text-right tabular-nums text-neutral-300">
                  {t.categoryCount} cats · {t.itemCount} items
                </td>
                <td className="py-3 pr-4">
                  <span className={t.active ? "text-emerald-300" : "text-neutral-500"}>
                    {t.active ? "● Active" : "○ Hidden"}
                  </span>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <form action={setTemplateActiveAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={t.active ? "0" : "1"} />
                      <button
                        type="submit"
                        className="border border-white/20 px-3 py-1.5 text-xs uppercase tracking-wider text-neutral-300 hover:border-admin-accent/50 hover:text-white"
                      >
                        {t.active ? "Hide" : "Activate"}
                      </button>
                    </form>
                    <DeleteTemplateButton id={t.id} name={t.name} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
