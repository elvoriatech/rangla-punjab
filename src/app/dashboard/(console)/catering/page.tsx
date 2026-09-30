import { FlashMessage } from "@/components/flash-message";
import { listCateringRequests, type CateringRow } from "@/lib/catering-service";
import { setCateringStatusAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/team-access";

/**
 * Catering enquiries from the app, soonest event first. Same working
 * pattern as Reservations: the guest asks, the restaurant calls back to
 * plan the menu and the price, and these buttons record the outcome.
 */

const DAY = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const RECEIVED = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-orange/15 text-orange-dark",
  confirmed: "bg-[#3f7030]/15 text-[#3f7030]",
  declined: "bg-red-900/10 text-red-900",
  cancelled: "bg-ink/10 text-muted",
};

/** "YYYY-MM-DD" drawn at noon UTC so the weekday never slips a day. */
function eventDay(iso: string): string {
  return DAY.format(new Date(`${iso}T12:00:00Z`));
}

function Detail({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <p className="flex items-baseline gap-2.5">
      <span aria-hidden="true" className="w-5 shrink-0 text-center">
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function OpenRequest({ r }: { r: CateringRow }): React.ReactElement {
  return (
    <li className="flex flex-col border-2 border-orange/50 bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-serif text-2xl">
          {eventDay(r.date)}
          {r.time ? ` · ${r.time}` : ""}
          <span
            className={`ml-3 rounded px-1.5 py-0.5 align-middle text-xs font-bold uppercase tracking-wider ${STATUS_STYLE[r.status] ?? ""}`}
          >
            {r.status}
          </span>
        </p>
        <p className="text-sm font-bold tabular-nums">
          {r.guests} {r.guests === 1 ? "guest" : "guests"}
        </p>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <Detail icon="👤" label="Name">
          {r.name}
        </Detail>
        <Detail icon="📞" label="Phone">
          <a href={`tel:${r.phone}`} className="underline underline-offset-2">
            {r.phone}
          </a>
        </Detail>
        {r.email ? (
          <Detail icon="✉️" label="Email">
            <a href={`mailto:${r.email}`} className="underline underline-offset-2">
              {r.email}
            </a>
          </Detail>
        ) : null}
        {r.location ? (
          <Detail icon="📍" label="Event venue">
            {r.location}
          </Detail>
        ) : null}
        {r.message ? (
          <Detail icon="📝" label="Message">
            <span className="whitespace-pre-line">{r.message}</span>
          </Detail>
        ) : null}
        <p className="pt-1 text-xs text-muted">Received {RECEIVED.format(r.createdAt)}</p>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        {r.status === "requested" ? (
          <form action={setCateringStatusAction}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value="confirmed" />
            <SubmitButton
              pendingLabel="Confirming…"
              className="whitespace-nowrap bg-orange px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-card hover:bg-orange-dark"
            >
              ✓ Confirm
            </SubmitButton>
          </form>
        ) : null}
        <form action={setCateringStatusAction}>
          <input type="hidden" name="id" value={r.id} />
          <input
            type="hidden"
            name="status"
            value={r.status === "confirmed" ? "cancelled" : "declined"}
          />
          <SubmitButton
            pendingLabel="Updating…"
            className="whitespace-nowrap border border-ink/20 px-3.5 py-2 text-[11px] uppercase tracking-[0.12em] text-muted hover:border-ink/50 hover:text-ink"
          >
            {r.status === "confirmed" ? "✕ Cancel" : "✕ Decline"}
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

export default async function CateringPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await requirePermission("catering");
  const { saved, error } = await searchParams;

  const rows = await listCateringRequests(userId);
  const open = rows.filter((r) => r.status === "requested" || r.status === "confirmed");
  const closed = rows.filter((r) => r.status === "declined" || r.status === "cancelled");

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12 text-ink lg:px-10">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Front of house</p>
      <h1 className="font-serif text-4xl leading-tight">Catering</h1>
      <p className="mt-2 text-sm text-muted">
        Catering requests from the app, soonest event first. Call the guest to plan the menu and
        price, then record the outcome here.
      </p>

      {saved ? <FlashMessage kind="success" text={`Catering request ${saved}.`} /> : null}
      {error ? <FlashMessage kind="error" text="That didn't work — try again." /> : null}

      <section aria-label="Open catering requests" className="mt-8">
        <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="mt-4 border border-ink/15 bg-card px-6 py-8 text-center text-sm text-muted">
            No catering requests yet. They appear here the moment a guest sends one from the app.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {open.map((r) => (
              <OpenRequest key={r.id} r={r} />
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section aria-label="Closed catering requests" className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Declined/cancelled</h2>
          <ul className="mt-4 divide-y divide-ink/10 border border-ink/15 bg-card text-sm text-muted">
            {closed.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 px-5 py-3">
                <span>
                  {eventDay(r.date)} · {r.name} · {r.guests}p ·{" "}
                  <a href={`tel:${r.phone}`} className="underline underline-offset-2">
                    {r.phone}
                  </a>
                </span>
                <span className="text-xs uppercase tracking-wider">{r.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
