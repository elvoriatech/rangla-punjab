import {
  CalendarDays,
  CreditCard,
  ReceiptText,
  ShoppingBag,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getVenueForUser } from "@/lib/venue-service";
import { formatPrice } from "@/lib/public-menu";
import { rangeLabel, resolveReportRange, type ReportPreset } from "@/lib/report-range";
import { getVenueReport } from "@/lib/report-service";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/team-access";

/**
 * Berichte / Statements — the restaurant's financial & operations report.
 * Preset or custom date range; summary, VAT, payment/order-type splits,
 * per-period table, top dishes; CSV + PDF exports covering EXACTLY the
 * window on screen (all three share resolveReportRange).
 */

const PRESETS: { key: Exclude<ReportPreset, "custom">; label: string }[] = [
  { key: "this_week", label: "Diese Woche" },
  { key: "this_month", label: "Dieser Monat" },
  { key: "last_month", label: "Letzter Monat" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}): Promise<React.ReactElement> {
  const userId = await requirePermission("reports");
  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");
  const venue = venueResult.value;

  const q = await searchParams;
  const range = resolveReportRange(q);
  const report = await getVenueReport(userId, venue.id, range);
  if (!report) redirect("/dashboard");

  const money = (cents: number): string => formatPrice(cents, report.venue.currency, "de");
  const qs = `preset=${range.preset}&from=${range.fromInput}&to=${range.toInput}`;
  // The per-order table speaks the same words as the two cards above it.
  const typeLabel = new Map<string, string>(report.byOrderType.map((t) => [t.key, t.label]));
  const methodLabel = new Map<string, string>(report.byPaymentMethod.map((m) => [m.key, m.label]));
  const maxPeriod = Math.max(0, ...report.periods.map((p) => p.grossCents));
  const maxItem = Math.max(0, ...report.topItems.map((t) => t.grossCents));

  return (
    <main className="px-6 py-10 lg:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Berichte</h1>
          <p className="mt-1 text-sm text-muted">
            Umsatz, MwSt. und Bestell-Auswertung — {rangeLabel(range)}. Beträge aus den
            Bestell-Snapshots; spätere Preisänderungen ändern keinen Bericht.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/dashboard/reports/export.csv?${qs}`}
            className="border border-ink/20 bg-card px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] hover:border-orange"
          >
            CSV Export
          </a>
          <a
            href={`/dashboard/reports/statement.pdf?${qs}`}
            className="bg-orange px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-card hover:bg-orange-dark"
          >
            Statement (PDF)
          </a>
        </div>
      </header>

      {/* Range picker */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={`/dashboard/reports?preset=${p.key}`}
            className={`rounded-2xl px-4 py-2 text-sm transition-colors [border-bottom-right-radius:3px] ${
              range.preset === p.key
                ? "bg-orange font-semibold text-card"
                : "border border-ink/15 bg-card hover:border-orange"
            }`}
          >
            {p.label}
          </Link>
        ))}
        <form className="ml-2 flex items-center gap-2" action="/dashboard/reports" method="get">
          <input type="hidden" name="preset" value="custom" />
          <input
            type="date"
            name="from"
            defaultValue={range.fromInput}
            className="border border-ink/20 bg-card px-2 py-1.5 text-sm"
            aria-label="Von"
          />
          <span className="text-sm text-muted">bis</span>
          <input
            type="date"
            name="to"
            defaultValue={range.toInput}
            className="border border-ink/20 bg-card px-2 py-1.5 text-sm"
            aria-label="Bis"
          />
          <SubmitButton
            pendingLabel="Wird geladen…"
            className="border border-ink/20 bg-card px-3 py-1.5 text-sm hover:border-orange"
          >
            Anzeigen
          </SubmitButton>
        </form>
      </div>

      {/* Summary tiles */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Tile label="Bestellungen" value={String(report.summary.orders)} />
        <Tile label="Umsatz (brutto)" value={money(report.summary.grossCents)} strong />
        <Tile label="Netto" value={money(report.summary.netCents)} />
        <Tile label="MwSt. 19% enthalten" value={money(report.summary.vatCents)} />
        <Tile label="Ø Bestellwert" value={money(report.summary.avgOrderCents)} />
      </div>
      {report.refunds.count > 0 ? (
        <p className="mt-3 text-sm text-red-900">
          {report.refunds.count} Erstattung(en) über {money(report.refunds.totalCents)} — nicht im
          Umsatz enthalten.
        </p>
      ) : null}

      {/* Where each report is — the page is long, and the per-order
          statement at the bottom was easy to miss. */}
      <nav aria-label="Berichte auf dieser Seite" className="mt-8 flex flex-wrap gap-2 text-xs">
        {SECTIONS.map((sec) => (
          <a
            key={sec.id}
            href={`#${sec.id}`}
            className="border border-ink/15 bg-card px-3 py-1.5 font-medium uppercase tracking-[0.12em] hover:border-orange"
          >
            {sec.label}
          </a>
        ))}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ReportCard
          id="zahlungsarten"
          icon={CreditCard}
          title="Zahlungsarten"
          hint="Wie bezahlt wurde — Anteil am Umsatz."
        >
          {report.byPaymentMethod.map((p) => (
            <BarRow
              key={p.key}
              label={p.label}
              meta={`${p.orders} Best. · ${p.sharePct}%`}
              value={money(p.totalCents)}
              pct={p.sharePct}
            />
          ))}
          {report.byPaymentMethod.length === 0 ? <Empty /> : null}
        </ReportCard>

        <ReportCard
          id="bestellarten"
          icon={ShoppingBag}
          title="Bestellarten"
          hint="Lieferung, Abholung, im Restaurant — Anteil am Umsatz."
        >
          {report.byOrderType.map((t) => (
            <BarRow
              key={t.key}
              label={t.label}
              meta={`${t.orders} Best. · ${t.sharePct}%`}
              value={money(t.totalCents)}
              pct={t.sharePct}
            />
          ))}
          {report.byOrderType.length === 0 ? <Empty /> : null}
        </ReportCard>

        <ReportCard
          id="zeitraum"
          icon={CalendarDays}
          title={
            report.granularity === "daily"
              ? "Umsatz nach Tag"
              : report.granularity === "weekly"
                ? "Umsatz nach Woche"
                : "Umsatz nach Monat"
          }
          hint="Brutto je Zeitabschnitt, mit enthaltener MwSt."
        >
          {report.periods.map((p) => (
            <BarRow
              key={p.key}
              label={p.label}
              meta={`${p.orders} Best. · MwSt. ${money(p.vatCents)}`}
              value={money(p.grossCents)}
              pct={share(p.grossCents, maxPeriod)}
            />
          ))}
          {report.periods.length === 0 ? <Empty /> : null}
        </ReportCard>

        <ReportCard
          id="top-gerichte"
          icon={UtensilsCrossed}
          title="Top-Gerichte"
          hint="Die meistverkauften Gerichte nach Umsatz."
        >
          {report.topItems.map((t) => (
            <BarRow
              key={t.name}
              label={t.name}
              meta={`${t.quantity}× verkauft`}
              value={money(t.grossCents)}
              pct={share(t.grossCents, maxItem)}
            />
          ))}
          {report.topItems.length === 0 ? <Empty /> : null}
        </ReportCard>
      </div>

      {/* The per-order statement: every order of the period on its own line. */}
      <section
        id="bestellungen"
        aria-labelledby="bestellungen-title"
        className="mt-6 scroll-mt-6 border border-ink/15 bg-card"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-orange px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center bg-orange text-card">
              <ReceiptText className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 id="bestellungen-title" className="font-serif text-xl leading-tight">
                Bestellungen einzeln ({report.orders.length})
              </h2>
              <p className="text-xs text-muted">
                Jede Bestellung im Zeitraum mit Art, Zahlung, MwSt. und Betrag.
              </p>
            </div>
          </div>
          <a
            href={`/dashboard/reports/export.csv?${qs}`}
            className="border border-ink/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] hover:border-orange"
          >
            Alle als CSV
          </a>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="bg-ink/[0.04] text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="px-5 py-2.5">
                  Nr.
                </th>
                <th scope="col" className="py-2.5">
                  Datum
                </th>
                <th scope="col" className="py-2.5">
                  Art
                </th>
                <th scope="col" className="py-2.5">
                  Zahlung
                </th>
                <th scope="col" className="py-2.5 text-right">
                  MwSt.
                </th>
                <th scope="col" className="py-2.5 text-right">
                  Gesamt
                </th>
                <th scope="col" className="px-5 py-2.5 text-right">
                  Im Umsatz
                </th>
              </tr>
            </thead>
            <tbody>
              {report.orders.slice(0, 100).map((o) => (
                <tr key={o.orderId} className="border-t border-ink/10 odd:bg-ink/[0.015]">
                  <td className="px-5 py-2.5 font-semibold tabular-nums">
                    #{String(o.orderNumber).padStart(4, "0")}
                  </td>
                  <td className="py-2.5 text-muted">
                    {new Intl.DateTimeFormat("de-DE", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: report.venue.timezone,
                    }).format(o.placedAt)}
                  </td>
                  <td className="py-2.5">{typeLabel.get(o.orderType) ?? o.orderType}</td>
                  <td className="py-2.5">
                    {methodLabel.get(o.paymentMethod) ?? o.paymentMethod}
                    {o.paymentStatus === "refunded" ? (
                      <span className="ml-2 border border-red-900/30 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-900">
                        erstattet
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-muted">{money(o.vatCents)}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">
                    {money(o.totalCents)}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {o.countsAsRevenue ? (
                      <span className="border border-green-900/25 bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-900">
                        Ja
                      </span>
                    ) : (
                      <span className="border border-ink/15 px-1.5 py-0.5 text-[11px] text-muted">
                        Nein
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {report.orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-sm text-muted">
                    Keine Bestellungen in diesem Zeitraum. Wählen Sie oben einen anderen Zeitraum.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {report.orders.length > 100 ? (
          <p className="border-t border-ink/10 px-5 py-3 text-xs text-muted">
            Erste 100 von {report.orders.length} — der CSV-Export enthält alle.
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Tile({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.ReactElement {
  return (
    <div className="border border-ink/10 bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p
        className={`mt-1 tabular-nums ${strong ? "text-xl font-bold text-orange" : "text-lg font-semibold"}`}
      >
        {value}
      </p>
    </div>
  );
}

/** In-page jumps, in page order. */
const SECTIONS = [
  { id: "zahlungsarten", label: "Zahlungsarten" },
  { id: "bestellarten", label: "Bestellarten" },
  { id: "zeitraum", label: "Nach Zeitraum" },
  { id: "top-gerichte", label: "Top-Gerichte" },
  { id: "bestellungen", label: "Bestellungen einzeln" },
] as const;

/** `part` as a whole percentage of `max` — the length of a row's bar. */
function share(part: number, max: number): number {
  return max > 0 ? Math.round((part / max) * 100) : 0;
}

/** One report: its own card, an icon and a title that say which one it
 *  is, and a line on what the numbers mean. */
function ReportCard({
  id,
  icon: Icon,
  title,
  hint,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 border border-ink/15 bg-card"
    >
      <header className="flex items-center gap-3 border-b border-ink/10 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-orange/40 bg-orange/10 text-orange-dark">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 id={`${id}-title`} className="font-serif text-xl leading-tight">
            {title}
          </h2>
          <p className="text-xs text-muted">{hint}</p>
        </div>
      </header>
      <ul className="divide-y divide-ink/10 px-5">{children}</ul>
    </section>
  );
}

/** A row whose bar shows its weight next to its neighbours at a glance;
 *  the figure itself stays in text, so the bar is never the only carrier. */
function BarRow({
  label,
  meta,
  value,
  pct,
}: {
  label: string;
  meta: string;
  value: string;
  pct: number;
}): React.ReactElement {
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <span aria-hidden className="h-1.5 flex-1 bg-ink/[0.07]">
          <span
            className="block h-full bg-orange"
            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
          />
        </span>
        <span className="shrink-0 text-xs text-muted">{meta}</span>
      </div>
    </li>
  );
}

function Empty(): React.ReactElement {
  return <li className="py-4 text-sm text-muted">Keine Daten im Zeitraum.</li>;
}
