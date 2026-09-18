import { redirect } from "next/navigation";
import { FlashMessage } from "@/components/flash-message";
import { getSessionUserId } from "@/lib/auth";
import { listReservations } from "@/lib/reservation-service";
import { getOrderingSettings } from "@/lib/venue-service";
import { setReservationStatusAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * Front-of-house reservations: what guests requested from the menu,
 * soonest first. The restaurant confirms by phone — these buttons record
 * the outcome so the floor plan and the guest's expectation match.
 */

const DAY = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin",
});

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-orange/15 text-orange-dark",
  confirmed: "bg-[#3f7030]/15 text-[#3f7030]",
  declined: "bg-red-900/10 text-red-900",
  cancelled: "bg-ink/10 text-muted",
};

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<React.ReactElement> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const { saved, error } = await searchParams;

  const orderingResult = await getOrderingSettings(userId);
  const reservationsOn = orderingResult.ok ? orderingResult.value.config.reservations : true;
  const rows = await listReservations(userId);
  const upcoming = rows.filter((r) => r.status === "requested" || r.status === "confirmed");
  const closed = rows.filter((r) => r.status === "declined" || r.status === "cancelled");

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12 text-ink lg:px-10">
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-gold-dark">Front of house</p>
      <h1 className="font-serif text-4xl leading-tight">Reservations</h1>
      <p className="mt-2 text-sm text-muted">
        Table requests from your menu, soonest first. Call the guest, then record the outcome here.
      </p>

      {saved ? <FlashMessage kind="success" text={`Reservation ${saved}.`} /> : null}
      {error ? <FlashMessage kind="error" text="That didn't work — try again." /> : null}

      {!reservationsOn ? (
        <p className="mt-6 border border-orange/40 bg-orange/10 px-4 py-3 text-sm">
          Reservations are switched <span className="font-semibold">off</span> — guests can&apos;t
          request tables right now. Turn them on under Settings → Table reservations.
        </p>
      ) : null}

      <section aria-label="Upcoming reservations" className="mt-8">
        <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-4 border border-ink/15 bg-card px-6 py-8 text-center text-sm text-muted">
            No table requests yet. They appear here the moment a guest sends one.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-col border-2 border-orange/50 bg-card px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-serif text-2xl">
                    {DAY.format(r.at)} · {r.time}
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
                {/* Icon column instead of NAME/PHONE/NOTE labels — the
                    glyph carries the meaning, and the sr-only word keeps
                    it readable for screen readers. */}
                <div className="mt-2 space-y-1 text-sm">
                  <p className="flex items-baseline gap-2.5">
                    <span aria-hidden="true" className="w-5 shrink-0 text-center">
                      👤
                    </span>
                    <span className="sr-only">Name</span>
                    {r.name}
                  </p>
                  <p className="flex items-baseline gap-2.5">
                    <span aria-hidden="true" className="w-5 shrink-0 text-center">
                      📞
                    </span>
                    <span className="sr-only">Phone</span>
                    <a href={`tel:${r.phone}`} className="underline underline-offset-2">
                      {r.phone}
                    </a>
                  </p>
                  {r.note ? (
                    <p className="flex items-baseline gap-2.5">
                      <span aria-hidden="true" className="w-5 shrink-0 text-center">
                        📝
                      </span>
                      <span className="sr-only">Note</span>
                      <span className="min-w-0 break-words">{r.note}</span>
                    </p>
                  ) : null}
                </div>
                <div className="mt-auto flex items-center gap-2 pt-4">
                  {r.status === "requested" ? (
                    <form action={setReservationStatusAction}>
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
                  <form action={setReservationStatusAction}>
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
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section aria-label="Closed reservations" className="mt-12">
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Declined/cancelled</h2>
          <ul className="mt-4 divide-y divide-ink/10 border border-ink/15 bg-card text-sm text-muted">
            {closed.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 px-5 py-3">
                <span>
                  {DAY.format(r.at)} · {r.time} · {r.name} · {r.guests}p
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
