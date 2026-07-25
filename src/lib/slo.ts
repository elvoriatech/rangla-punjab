/**
 * SLOs as code. The roadmap §9 names the service-level objectives we
 * page on; this file makes them a first-class artefact so the runbook
 * page (P2-5), the burn-rate alerts (P2-3 metrics + Grafana rules),
 * and any future exit-criteria smoke can all read the same shape.
 *
 * The map is deep-frozen so a route handler cannot mutate an SLO at
 * runtime and drift the paging thresholds away from what's
 * checked-in.
 *
 * Numeric target sources:
 *   - `public_menu_p95_latency` — roadmap §4 exit criterion (p95 < 1 s
 *     on 4G) turned into the paging line.
 *   - `cdn_cache_hit_ratio` — roadmap §10 ("with >99% CDN hit ratio").
 *   - `dashboard_error_rate` — no explicit number in §9; a 1 % 5xx
 *     ceiling is the industry-standard number for a SaaS control
 *     plane and matches what P2-3's error counters can measure.
 *   - `publish_to_live_latency` — no explicit number in §9; the
 *     roadmap §7 publish flow implies a "seconds, not minutes" ceiling
 *     (public menu re-cache after a purge); 30 s p95 is a defensible
 *     first cut and gives a clear regression signal.
 *
 * Burn-rate alerts follow the Google SRE Workbook multi-window
 * recommendation: fast burn (2 % budget in 1 h → page), medium burn
 * (5 % budget in 6 h → page), slow burn (10 % budget in 3 d → ticket).
 * A future task can move the numbers into Grafana alert rules; the
 * shape here is what those rules will read from.
 */

export const SLO_IDS = [
  "public_menu_p95_latency",
  "cdn_cache_hit_ratio",
  "dashboard_error_rate",
  "publish_to_live_latency",
] as const;

export type SLOId = (typeof SLO_IDS)[number];

export type Comparison = "lte" | "gte";

export type Unit = "ms" | "ratio";

export interface BurnAlert {
  severity: "page" | "ticket";
  /** Rolling window the burn-rate is evaluated over. */
  windowMinutes: number;
  /** Fraction of the 28-day budget that must burn in `windowMinutes` to fire. */
  budgetFraction: number;
}

export interface SLO {
  readonly id: SLOId;
  readonly name: string;
  readonly description: string;
  /** Roadmap §9 phrase — asserted verbatim by the vitest suite so any drift
   * from the source-of-truth doc surfaces immediately. */
  readonly indicator: string;
  readonly target: number;
  readonly unit: Unit;
  readonly comparison: Comparison;
  readonly windowDays: 28;
  readonly burnAlerts: readonly BurnAlert[];
  /** Prometheus metric names (P2-3) that feed this SLO. */
  readonly metrics: readonly string[];
}

const RAW_SLOS: Record<SLOId, SLO> = {
  public_menu_p95_latency: {
    id: "public_menu_p95_latency",
    name: "Public menu p95 latency",
    description:
      "95th-percentile latency of a public menu render at `/`. Roadmap §4 exit criterion.",
    indicator: "public-menu p95 latency",
    target: 1000,
    unit: "ms",
    comparison: "lte",
    windowDays: 28,
    burnAlerts: STANDARD_BURN_ALERTS(),
    metrics: ["http_request_duration_seconds"],
  },
  cdn_cache_hit_ratio: {
    id: "cdn_cache_hit_ratio",
    name: "CDN cache-hit ratio",
    description:
      "Fraction of public-menu requests served by Cloudflare without touching the origin. Roadmap §10 (>99%).",
    indicator: "CDN cache-hit ratio",
    target: 0.99,
    unit: "ratio",
    comparison: "gte",
    windowDays: 28,
    burnAlerts: STANDARD_BURN_ALERTS(),
    metrics: ["cdn_purge_total"],
  },
  dashboard_error_rate: {
    id: "dashboard_error_rate",
    name: "Dashboard error rate",
    description:
      'Fraction of `/dashboard/*` requests returning 5xx. Target derived by architect from roadmap §9 ("error rate").',
    indicator: "error rate",
    target: 0.01,
    unit: "ratio",
    comparison: "lte",
    windowDays: 28,
    burnAlerts: STANDARD_BURN_ALERTS(),
    metrics: ["http_requests_total"],
  },
  publish_to_live_latency: {
    id: "publish_to_live_latency",
    name: "Publish → live latency",
    description:
      "p95 wall-clock delay between an operator hitting Publish and the change being served from the CDN.",
    indicator: "publish→live time",
    target: 30_000,
    unit: "ms",
    comparison: "lte",
    windowDays: 28,
    burnAlerts: STANDARD_BURN_ALERTS(),
    metrics: ["bullmq_job_duration_seconds", "cdn_purge_total"],
  },
};

function STANDARD_BURN_ALERTS(): readonly BurnAlert[] {
  // Google SRE Workbook multi-window burn-rate alerting, sized against
  // a 28-day window. Any faster/slower cadence can be added per-SLO
  // later.
  return Object.freeze([
    { severity: "page", windowMinutes: 60, budgetFraction: 0.02 },
    { severity: "page", windowMinutes: 360, budgetFraction: 0.05 },
    { severity: "ticket", windowMinutes: 4320, budgetFraction: 0.1 },
  ]);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

export const SLO: Readonly<Record<SLOId, SLO>> = deepFreeze(RAW_SLOS);

/**
 * Return the SLO catalogue as an array shaped for a runbook page or
 * status-page renderer. The array is freshly created but its entries
 * are the same frozen objects — mutations still throw in strict mode.
 */
export function describeSlos(): SLO[] {
  return SLO_IDS.map((id) => SLO[id]);
}
