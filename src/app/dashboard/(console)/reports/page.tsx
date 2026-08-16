import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getVenueForUser } from "@/lib/venue-service";
import { formatPrice } from "@/lib/public-menu";
import { rangeLabel, resolveReportRange, type ReportPreset } from "@/lib/report-range";
import { getVenueReport } from "@/lib/report-service";

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
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const venueResult = await getVenueForUser(userId);
  if (!venueResult.ok) redirect("/dashboard");
  const venue = venueResult.value;

  const q = await searchParams;
  const range = resolveReportRange(q);
  const report = await getVenueReport(userId, venue.id, range);
  if (!report) redirect("/dashboard");

  const money = (cents: number): string => formatPrice(cents, report.venue.currency, "de");
  const qs = `preset=${range.preset}&from=${range.fromInput}&to=${range.toInput}`;

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
          <button
            type="submit"
            className="border border-ink/20 bg-card px-3 py-1.5 text-sm hover:border-orange"
          >
            Anzeigen
          </button>
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

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {/* Payment methods */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Zahlungsarten</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {report.byPaymentMethod.map((p) => (
                <tr key={p.key} className="border-b border-ink/10">
                  <td className="py-2">{p.label}</td>
                  <td className="py-2 text-right text-muted">{p.orders} Best.</td>
                  <td className="py-2 text-right text-muted">{p.sharePct}%</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(p.totalCents)}
                  </td>
                </tr>
              ))}
              {report.byPaymentMethod.length === 0 ? <Empty /> : null}
            </tbody>
          </table>
        </section>

        {/* Order types */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Bestellarten</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {report.byOrderType.map((t) => (
                <tr key={t.key} className="border-b border-ink/10">
                  <td className="py-2">{t.label}</td>
                  <td className="py-2 text-right text-muted">{t.orders} Best.</td>
                  <td className="py-2 text-right text-muted">{t.sharePct}%</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(t.totalCents)}
                  </td>
                </tr>
              ))}
              {report.byOrderType.length === 0 ? <Empty /> : null}
            </tbody>
          </table>
        </section>

        {/* Periods */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">
            {report.granularity === "daily"
              ? "Nach Tag"
              : report.granularity === "weekly"
                ? "Nach Woche"
                : "Nach Monat"}
          </h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {report.periods.map((p) => (
                <tr key={p.key} className="border-b border-ink/10">
                  <td className="py-2">{p.label}</td>
                  <td className="py-2 text-right text-muted">{p.orders} Best.</td>
                  <td className="py-2 text-right text-muted">MwSt. {money(p.vatCents)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(p.grossCents)}
                  </td>
                </tr>
              ))}
              {report.periods.length === 0 ? <Empty /> : null}
            </tbody>
          </table>
        </section>

        {/* Top dishes */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">Top-Gerichte</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {report.topItems.map((t) => (
                <tr key={t.name} className="border-b border-ink/10">
                  <td className="py-2">
                    <span className="font-semibold text-orange">{t.quantity}×</span> {t.name}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(t.grossCents)}
                  </td>
                </tr>
              ))}
              {report.topItems.length === 0 ? <Empty /> : null}
            </tbody>
          </table>
        </section>
      </div>

      {/* Order rows */}
      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-[0.28em] text-gold-dark">
          Bestellungen im Zeitraum ({report.orders.length})
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-ink/20 text-left text-xs uppercase tracking-wider text-muted">
                <th className="py-2">Nr.</th>
                <th className="py-2">Datum</th>
                <th className="py-2">Art</th>
                <th className="py-2">Zahlung</th>
                <th className="py-2 text-right">MwSt.</th>
                <th className="py-2 text-right">Gesamt</th>
                <th className="py-2 text-right">Umsatz?</th>
              </tr>
            </thead>
            <tbody>
              {report.orders.slice(0, 100).map((o) => (
                <tr key={o.orderId} className="border-b border-ink/10">
                  <td className="py-2 font-semibold">#{String(o.orderNumber).padStart(4, "0")}</td>
                  <td className="py-2 text-muted">
                    {new Intl.DateTimeFormat("de-DE", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: report.venue.timezone,
                    }).format(o.placedAt)}
                  </td>
                  <td className="py-2">{o.orderType}</td>
                  <td className="py-2">
                    {o.paymentMethod}
                    {o.paymentStatus === "refunded" ? " (erstattet)" : ""}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted">{money(o.vatCents)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(o.totalCents)}
                  </td>
                  <td className="py-2 text-right">{o.countsAsRevenue ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.orders.length > 100 ? (
            <p className="mt-2 text-xs text-muted">
              Erste 100 von {report.orders.length} — der CSV-Export enthält alle.
            </p>
          ) : null}
        </div>
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

function Empty(): React.ReactElement {
  return (
    <tr>
      <td className="py-3 text-sm text-muted">Keine Daten im Zeitraum.</td>
    </tr>
  );
}
