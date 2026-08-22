import Link from "next/link";
import { FlashMessage } from "@/components/flash-message";
import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { listActiveTemplates } from "@/lib/menu-template-service";
import { SUPPORTED_CURRENCIES, SUPPORTED_LOCALES } from "@/lib/venue-service";
import { provisionRestaurantAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

const ERRORS: Record<string, string> = {
  invalid: "Please check the fields and try again.",
  duplicate_email: "An account with that owner email already exists.",
  unknown_template: "That starter template no longer exists.",
  invalid_template: "That starter template is misconfigured.",
};

/**
 * Provision Restaurant (P3-2). Operator-only form: name + owner email +
 * starter template + venue → creates the restaurant end-to-end and emails
 * the owner a set-password invite. Gated on isPlatformAdmin (404 for
 * everyone else, matching the rest of /admin).
 */
export default async function ProvisionRestaurantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if (!(await isPlatformAdmin(userId))) notFound();

  const templates = await listActiveTemplates();
  const { error } = await searchParams;

  const field = "block text-xs uppercase tracking-[0.18em] text-neutral-400 mb-1";
  const input =
    "w-full border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-neutral-100 focus:border-admin-accent/60 focus:outline-none";

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-12 text-neutral-100">
      <Link href="/admin/restaurants" className="text-xs text-admin-accent/90 hover:underline">
        ← Restaurants
      </Link>
      <h1 className="mt-3 font-serif text-3xl">Provision a restaurant</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Creates the restaurant from a starter template and emails the owner a link to set their
        password.
      </p>

      {error ? (
        <FlashMessage
          kind="error"
          text={ERRORS[error] ?? "Something went wrong — nothing was created."}
        />
      ) : null}

      <form action={provisionRestaurantAction} className="mt-8 space-y-5">
        <div>
          <label htmlFor="restaurantName" className={field}>
            Restaurant name
          </label>
          <input
            id="restaurantName"
            name="restaurantName"
            required
            maxLength={120}
            className={input}
          />
        </div>

        <div>
          <label htmlFor="venueName" className={field}>
            Venue / branch name (optional)
          </label>
          <input
            id="venueName"
            name="venueName"
            maxLength={120}
            placeholder="Defaults to the restaurant name"
            className={input}
          />
        </div>

        <div>
          <label htmlFor="ownerEmail" className={field}>
            Owner email
          </label>
          <input id="ownerEmail" name="ownerEmail" type="email" required className={input} />
        </div>

        <div>
          <label htmlFor="templateKey" className={field}>
            Starter menu template
          </label>
          <select id="templateKey" name="templateKey" required className={input}>
            {templates.length === 0 ? (
              <option value="">No templates — seed one first</option>
            ) : (
              templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.emoji} {t.name} — {t.categoryCount} categories · {t.itemCount} dishes
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="currency" className={field}>
              Currency
            </label>
            <select id="currency" name="currency" className={input} defaultValue="EUR">
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="locale" className={field}>
              Default language
            </label>
            <select id="locale" name="locale" className={input} defaultValue="en">
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SubmitButton
          disabled={templates.length === 0}
          pendingLabel="Provisioning…"
          className="mt-2 bg-admin-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-900 hover:bg-admin-accent disabled:opacity-40"
        >
          Provision + invite owner
        </SubmitButton>
      </form>
    </main>
  );
}
