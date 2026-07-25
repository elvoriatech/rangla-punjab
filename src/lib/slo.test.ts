import { describe, expect, it } from "vitest";
import { SLO, SLO_IDS, describeSlos, type SLO as SLOType } from "./slo";

// The roadmap-§9 phrases the SLO catalogue must expose verbatim. Any
// drift (rename, capitalisation change) trips the assertion — the
// runbook page + Grafana rules point at these phrases as their source
// of truth.
const ROADMAP_INDICATORS = {
  public_menu_p95_latency: "public-menu p95 latency",
  cdn_cache_hit_ratio: "CDN cache-hit ratio",
  dashboard_error_rate: "error rate",
  publish_to_live_latency: "publish→live time",
} as const;

describe("SLO catalogue (P2-4)", () => {
  it("exposes exactly the four SLOs from roadmap §9", () => {
    expect(SLO_IDS).toHaveLength(4);
    expect(new Set(SLO_IDS)).toEqual(
      new Set([
        "public_menu_p95_latency",
        "cdn_cache_hit_ratio",
        "dashboard_error_rate",
        "publish_to_live_latency",
      ]),
    );
  });

  it.each(SLO_IDS)("%s has target/window/burn-alert fields set", (id) => {
    const slo = SLO[id];
    expect(slo.id).toBe(id);
    expect(slo.name).toBeTruthy();
    expect(slo.description).toBeTruthy();
    expect(slo.target).toBeGreaterThan(0);
    expect(slo.unit).toMatch(/^(ms|ratio)$/);
    expect(slo.comparison).toMatch(/^(lte|gte)$/);
    expect(slo.windowDays).toBe(28);
    expect(slo.burnAlerts.length).toBeGreaterThan(0);
    for (const b of slo.burnAlerts) {
      expect(b.severity).toMatch(/^(page|ticket)$/);
      expect(b.windowMinutes).toBeGreaterThan(0);
      expect(b.budgetFraction).toBeGreaterThan(0);
      expect(b.budgetFraction).toBeLessThanOrEqual(1);
    }
    expect(slo.metrics.length).toBeGreaterThan(0);
  });

  it("indicator strings match the roadmap §9 phrasing verbatim", () => {
    for (const id of SLO_IDS) {
      expect(SLO[id].indicator).toBe(ROADMAP_INDICATORS[id]);
    }
  });

  it("cache-hit + dashboard-error targets use ratios in [0, 1]", () => {
    expect(SLO.cdn_cache_hit_ratio.unit).toBe("ratio");
    expect(SLO.cdn_cache_hit_ratio.target).toBeGreaterThan(0);
    expect(SLO.cdn_cache_hit_ratio.target).toBeLessThanOrEqual(1);
    expect(SLO.cdn_cache_hit_ratio.comparison).toBe("gte");
    expect(SLO.dashboard_error_rate.unit).toBe("ratio");
    expect(SLO.dashboard_error_rate.target).toBeGreaterThan(0);
    expect(SLO.dashboard_error_rate.target).toBeLessThanOrEqual(1);
    expect(SLO.dashboard_error_rate.comparison).toBe("lte");
  });

  it("latency targets use ms + lte comparison", () => {
    expect(SLO.public_menu_p95_latency.unit).toBe("ms");
    expect(SLO.public_menu_p95_latency.comparison).toBe("lte");
    expect(SLO.publish_to_live_latency.unit).toBe("ms");
    expect(SLO.publish_to_live_latency.comparison).toBe("lte");
  });

  it("burn-alert cadence is multi-window: at least one page + one ticket window", () => {
    for (const id of SLO_IDS) {
      const alerts = SLO[id].burnAlerts;
      expect(alerts.some((a) => a.severity === "page")).toBe(true);
      expect(alerts.some((a) => a.severity === "ticket")).toBe(true);
    }
  });

  it("frozen map mutation throws (defence against runtime drift)", () => {
    expect(() => {
      (SLO as unknown as Record<string, unknown>).extra = "nope";
    }).toThrow();
    expect(() => {
      (SLO.public_menu_p95_latency as unknown as { target: number }).target = 9999;
    }).toThrow();
    expect(() => {
      (SLO.public_menu_p95_latency.burnAlerts as unknown as BurnAlert[]).push({
        severity: "page",
        windowMinutes: 15,
        budgetFraction: 0.5,
      });
    }).toThrow();
  });

  it("describeSlos() returns every SLO in the declared order", () => {
    const arr = describeSlos();
    expect(arr.map((s) => s.id)).toEqual([...SLO_IDS]);
    for (const s of arr) expect(s).toBe(SLO[s.id]);
  });

  it("references only Prometheus metric names that P2-3 actually publishes", () => {
    const published = new Set([
      "http_requests_total",
      "http_request_duration_seconds",
      "bullmq_jobs_total",
      "bullmq_job_duration_seconds",
      "stripe_webhook_events_total",
      "cdn_purge_total",
    ]);
    const allReferenced = new Set<string>();
    for (const id of SLO_IDS) for (const m of SLO[id].metrics) allReferenced.add(m);
    for (const m of allReferenced) {
      expect(published, `SLO references unknown metric "${m}"`).toContain(m);
    }
  });
});

// Local alias so the mutation-throws test doesn't have to re-import.
type BurnAlert = SLOType["burnAlerts"][number];
