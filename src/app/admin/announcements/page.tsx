import { BRAND } from "@/lib/brand";
import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { accessForRow, adminListTenants } from "@/lib/platform-admin";
import { announceAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * Announcements — one message to many owners. Targets derive from the
 * same plan-state used everywhere; counts show the real audience
 * before sending. Dev sends land in Mailhog; production goes through
 * the same seam to Resend.
 */

export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; skipped?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const tenants = await adminListTenants(userId);
  if (!tenants) notFound();
  const { sent, skipped, error } = await searchParams;

  const reachable = tenants
    .filter((t) => t.ownerEmail && !t.deletedAt)
    .map((t) => ({ t, access: accessForRow(t) }));
  const counts = {
    all: reachable.length,
    trial: reachable.filter((a) => a.access.state === "trial").length,
    active: reachable.filter((a) => a.access.state === "active" || a.access.state === "override")
      .length,
    lapsed: reachable.filter(
      (a) => a.access.state === "lapsed_grace" || a.access.state === "lapsed_off",
    ).length,
  };

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="mx-auto max-w-3xl">
        <h1 className="font-serif text-3xl text-white">Announcements</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Email every owner in a segment — new features, price changes, maintenance windows.
        </p>
      </header>

      {sent ? (
        <p
          role="status"
          className="mx-auto mt-6 max-w-3xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          Sent to {sent} owner{sent === "1" ? "" : "s"}
          {skipped && skipped !== "0" ? ` · ${skipped} failed` : ""}.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mx-auto mt-6 max-w-3xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          Subject and message are required (subject ≤ 150 chars, message ≤ 5000).
        </p>
      ) : null}

      <form
        action={announceAction}
        className="mx-auto mt-8 max-w-3xl space-y-5 border border-white/10 bg-white/[0.02] p-6"
      >
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-[0.16em] text-neutral-500">Audience</span>
          <select
            name="target"
            defaultValue="all"
            className="mt-1.5 w-full border border-white/15 bg-admin-surface px-3 py-2.5 text-sm text-white outline-none focus:border-admin-accent/60"
          >
            <option value="all">All owners · {counts.all}</option>
            <option value="active">Paying (incl. overrides) · {counts.active}</option>
            <option value="trial">In trial · {counts.trial}</option>
            <option value="lapsed">Lapsed · {counts.lapsed}</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-[0.16em] text-neutral-500">Subject</span>
          <input
            type="text"
            name="subject"
            required
            maxLength={150}
            placeholder="New: guests can now order delivery"
            className="mt-1.5 w-full border border-white/15 bg-admin-surface px-3 py-2.5 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs uppercase tracking-[0.16em] text-neutral-500">Message</span>
          <textarea
            name="message"
            required
            maxLength={5000}
            rows={8}
            placeholder={
              "What changed, why it matters to their restaurant, what to do next.\n\nBlank lines become paragraphs."
            }
            className="mt-1.5 w-full border border-white/15 bg-admin-surface px-3 py-2.5 text-sm leading-relaxed text-white outline-none placeholder:text-neutral-600 focus:border-admin-accent/60"
          />
        </label>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-neutral-500">
            Each email is personalised (&quot;Hi {"{restaurant}"}&quot;) and signed by the{" "}
            {BRAND.name}
            team.
          </p>
          <SubmitButton
            pendingLabel="Sending…"
            className="border border-admin-accent/50 bg-admin-accent/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-admin-accent hover:bg-admin-accent/20 disabled:opacity-70"
          >
            Send announcement
          </SubmitButton>
        </div>
      </form>
    </main>
  );
}
