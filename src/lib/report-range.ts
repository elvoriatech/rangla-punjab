import { presetRange, type ReportRange } from "./report-service";

/**
 * Turn URL search params into a report range.
 *
 * Lives apart from the page so the page, the CSV route and the PDF route
 * all resolve a range identically — an export that covered a different
 * window than the screen it was exported from is the kind of bug an
 * accountant finds months later.
 */

export type ReportPreset = "this_week" | "this_month" | "last_month" | "custom";

export interface ResolvedRange extends ReportRange {
  preset: ReportPreset;
  /** `YYYY-MM-DD`, for round-tripping into the date inputs. */
  fromInput: string;
  toInput: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const asDayString = (d: Date): string => d.toISOString().slice(0, 10);

/** `now` is injected so tests are deterministic and page === export. */
export function resolveReportRange(
  q: { preset?: string; from?: string; to?: string },
  now: Date = new Date(),
): ResolvedRange {
  // A complete, well-formed custom range wins; anything malformed falls
  // back to the default rather than erroring.
  if (q.preset === "custom" && ISO_DAY.test(q.from ?? "") && ISO_DAY.test(q.to ?? "")) {
    const from = new Date(`${q.from}T00:00:00.000Z`);
    const to = new Date(`${q.to}T23:59:59.999Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      return { from, to, preset: "custom", fromInput: q.from!, toInput: q.to! };
    }
  }

  const preset: Exclude<ReportPreset, "custom"> =
    q.preset === "this_week" || q.preset === "last_month" ? q.preset : "this_month";
  const range = presetRange(preset, now);
  return {
    ...range,
    preset,
    fromInput: asDayString(range.from),
    toInput: asDayString(range.to),
  };
}

/** Human label for the window, e.g. "01.08.26 – 31.08.26" (UTC-formatted,
 *  matching how presetRange constructs the boundaries). */
export function rangeLabel(range: ReportRange): string {
  const fmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeZone: "UTC" });
  return `${fmt.format(range.from)} – ${fmt.format(range.to)}`;
}
