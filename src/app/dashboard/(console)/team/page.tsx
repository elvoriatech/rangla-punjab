import { FlashMessage } from "@/components/flash-message";
import { SubmitButton } from "@/components/submit-button";
import { requireOwner, PERMISSION_LABELS, PRESETS } from "@/lib/team-access";
import { listTeam, STAFF_PASSWORD_MIN_LENGTH } from "@/lib/team-service";
import {
  createStaffAction,
  removeStaffAction,
  setStaffPasswordAction,
  updateStaffAction,
} from "./actions";
import { PermissionPicker } from "./permission-picker";

/**
 * Team — the owner's logins for managers and staff (owner, 2026-09-30).
 * The owner sets email + password and hands them over; each person sees
 * the same dashboard, with only the ticked areas. Owner-only page.
 */

const SAVED: Record<string, string> = {
  created: "Team member added. Give them the email and password you set.",
  updated: "Access saved. It applies on their next click.",
  password: "New password set. They have been signed out everywhere.",
  removed: "Removed. Their login no longer works.",
};

const ERRORS: Record<string, string> = {
  email_taken: "That email already has a login. Use a different one.",
  invalid_email: "That doesn't look like an email address.",
  weak_password: `The password needs at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`,
  invalid_name: "Please enter a name (up to 60 characters).",
  not_found: "That team member no longer exists.",
  forbidden: "Only the owner can manage the team.",
};

const input =
  "mt-1 w-full border border-ink/20 bg-card px-3 py-2 text-sm focus:border-ink/60 focus:outline-none";
const primary =
  "whitespace-nowrap bg-orange px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-card hover:bg-orange-dark";
const quiet =
  "whitespace-nowrap border border-ink/20 px-3.5 py-2 text-[11px] uppercase tracking-[0.12em] text-muted hover:border-ink/50 hover:text-ink";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await requireOwner();
  const { saved, error } = await searchParams;
  const team = await listTeam(userId);
  const members = team.ok ? team.value : [];
  const staff = members.filter((m) => !m.isOwner);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12 text-ink lg:px-10">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Owner</p>
      <h1 className="font-serif text-4xl leading-tight">Team</h1>
      <p className="mt-2 text-sm text-muted">
        Create logins for your manager and staff. They sign in on the same login page and see the
        same dashboard — only the areas you tick. Payments and this page always stay yours.
      </p>

      {saved && SAVED[saved] ? <FlashMessage kind="success" text={SAVED[saved]} /> : null}
      {error ? (
        <FlashMessage kind="error" text={ERRORS[error] ?? "That didn't work — try again."} />
      ) : null}

      <section aria-labelledby="add-heading" className="mt-8 border-2 border-orange/50 bg-card p-5">
        <h2 id="add-heading" className="font-serif text-2xl">
          Add a team member
        </h2>
        <form action={createStaffAction} className="mt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              Name
              <input
                name="name"
                required
                maxLength={60}
                placeholder="Ali — kitchen"
                className={input}
              />
            </label>
            <label className="block text-sm">
              Login email
              <input
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="ali@example.com"
                className={input}
              />
            </label>
            <label className="block text-sm">
              Password
              <input
                name="password"
                type="text"
                required
                minLength={STAFF_PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                placeholder={`At least ${STAFF_PASSWORD_MIN_LENGTH} characters`}
                className={input}
              />
            </label>
          </div>
          <PermissionPicker initial={PRESETS.staff} idPrefix="new" />
          <div className="mt-4">
            <SubmitButton pendingLabel="Adding…" className={primary}>
              Add team member
            </SubmitButton>
          </div>
        </form>
      </section>

      <section aria-labelledby="team-heading" className="mt-10">
        <h2 id="team-heading" className="text-xs uppercase tracking-[0.28em] text-gold-dark">
          Your team ({staff.length})
        </h2>
        {staff.length === 0 ? (
          <p className="mt-4 border border-ink/15 bg-card px-6 py-8 text-center text-sm text-muted">
            No team members yet. Add one above.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {staff.map((m) => (
              <li key={m.membershipId} className="border border-ink/15 bg-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-serif text-xl">{m.displayName ?? m.email}</p>
                  <p className="text-sm text-muted">{m.email}</p>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Can open:{" "}
                  {m.permissions.length
                    ? m.permissions.map((p) => PERMISSION_LABELS[p].label).join(" · ")
                    : "nothing yet"}
                </p>

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold underline underline-offset-2">
                    Change name or access
                  </summary>
                  <form action={updateStaffAction} className="mt-3">
                    <input type="hidden" name="id" value={m.membershipId} />
                    <label className="block max-w-sm text-sm">
                      Name
                      <input
                        name="name"
                        required
                        maxLength={60}
                        defaultValue={m.displayName ?? ""}
                        className={input}
                      />
                    </label>
                    <PermissionPicker initial={m.permissions} idPrefix={m.membershipId} />
                    <div className="mt-4">
                      <SubmitButton pendingLabel="Saving…" className={primary}>
                        Save access
                      </SubmitButton>
                    </div>
                  </form>
                </details>

                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-ink/10 pt-4">
                  <form action={setStaffPasswordAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={m.membershipId} />
                    <label className="block text-sm">
                      New password
                      <input
                        name="password"
                        type="text"
                        required
                        minLength={STAFF_PASSWORD_MIN_LENGTH}
                        autoComplete="new-password"
                        className={input}
                      />
                    </label>
                    <SubmitButton pendingLabel="Setting…" className={quiet}>
                      Set password
                    </SubmitButton>
                  </form>
                  <form action={removeStaffAction} className="ml-auto">
                    <input type="hidden" name="id" value={m.membershipId} />
                    <SubmitButton pendingLabel="Removing…" className={quiet}>
                      ✕ Remove
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
