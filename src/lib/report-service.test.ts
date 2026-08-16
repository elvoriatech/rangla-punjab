import { describe, expect, it } from "vitest";
import {
  countsAsRevenue,
  granularityFor,
  paymentMethodOf,
  presetRange,
  vatFromGross,
} from "./report-service";
import { resolveReportRange } from "./report-range";
import { reportToCsv } from "./report-export";
import type { VenueReport } from "./report-service";

describe("vatFromGross (19% included)", () => {
  it("extracts VAT from a gross amount", () => {
    // 11,90 € gross → 10,00 € net + 1,90 € VAT
    expect(vatFromGross(1190)).toBe(190);
    expect(vatFromGross(0)).toBe(0);
  });
  it("net + vat always reassembles the gross", () => {
    for (const gross of [1, 99, 590, 1850, 123456]) {
      const vat = vatFromGross(gross);
      expect(vat + (gross - vat)).toBe(gross);
      expect(vat).toBeGreaterThanOrEqual(0);
      expect(vat).toBeLessThan(gross || 1);
    }
  });
});

describe("countsAsRevenue", () => {
  it("counts paid orders and fulfilled cash orders, never refunds", () => {
    expect(countsAsRevenue("paid", "placed")).toBe(true);
    expect(countsAsRevenue("none", "done")).toBe(true);
    expect(countsAsRevenue("refunded", "done")).toBe(false);
    expect(countsAsRevenue("none", "placed")).toBe(false);
    expect(countsAsRevenue("pending", "preparing")).toBe(false);
  });
});

describe("paymentMethodOf", () => {
  it("splits cash vs stripe vs paypal", () => {
    expect(paymentMethodOf("paid", "paypal")).toBe("paypal");
    expect(paymentMethodOf("paid", "stripe")).toBe("stripe");
    expect(paymentMethodOf("paid", null)).toBe("stripe"); // pre-column orders
    expect(paymentMethodOf("refunded", "paypal")).toBe("paypal");
    expect(paymentMethodOf("none", null)).toBe("cash");
    expect(paymentMethodOf("pending", "stripe")).toBe("cash"); // never settled
  });
});

describe("ranges", () => {
  const now = new Date("2026-08-16T12:00:00.000Z"); // a Sunday

  it("presetRange builds calendar months and ISO weeks", () => {
    const month = presetRange("this_month", now);
    expect(month.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(month.to.toISOString()).toBe("2026-08-31T23:59:59.999Z");
    const week = presetRange("this_week", now);
    expect(week.from.getUTCDay()).toBe(1); // Monday
    expect(week.to.getTime()).toBeGreaterThan(week.from.getTime());
  });

  it("resolveReportRange honours a valid custom range and rejects garbage", () => {
    const ok = resolveReportRange({ preset: "custom", from: "2026-08-01", to: "2026-08-15" }, now);
    expect(ok.preset).toBe("custom");
    expect(ok.fromInput).toBe("2026-08-01");
    const bad = resolveReportRange({ preset: "custom", from: "15.08.2026", to: "x" }, now);
    expect(bad.preset).toBe("this_month"); // fell back
    const inverted = resolveReportRange(
      { preset: "custom", from: "2026-08-20", to: "2026-08-01" },
      now,
    );
    expect(inverted.preset).toBe("this_month");
  });

  it("granularity follows range length", () => {
    expect(granularityFor(presetRange("this_week", now))).toBe("daily");
    expect(granularityFor(presetRange("this_month", now))).toBe("weekly");
    expect(
      granularityFor({
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-06-30T23:59:59Z"),
      }),
    ).toBe("monthly");
  });
});

describe("reportToCsv", () => {
  it("emits RFC-4180 CSV with dot-decimal amounts and quoted fields", () => {
    const report = {
      orders: [
        {
          orderId: "o1",
          orderNumber: 42,
          placedAt: new Date("2026-08-10T11:30:00.000Z"),
          status: "done",
          paymentStatus: "paid",
          orderType: "delivery",
          paymentMethod: "paypal",
          netCents: 1000,
          vatCents: 190,
          totalCents: 1190,
          countsAsRevenue: true,
        },
      ],
    } as unknown as VenueReport;
    const csv = reportToCsv(report);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Order Number");
    expect(lines[1]).toBe(
      "0042,2026-08-10T11:30:00.000Z,delivery,done,paypal,paid,yes,10.00,1.90,11.90",
    );
  });
});
