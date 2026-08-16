import { describe, expect, it } from "vitest";

import {
  OFFER_GRACE_MINUTES,
  effectiveItemPrice,
  effectiveItemPriceWithGrace,
  offerActiveAt,
  parseOfferWeekly,
  type OfferItemFields,
} from "./offer-pricing";

/**
 * OFFER-2 — the pricing authority, table-tested against a wall calendar.
 *
 * Every instant below is stated in UTC and asserted against Europe/Berlin
 * (CEST = UTC+2 in August, CET = UTC+1 in winter), because the venue's clock —
 * not the server's — decides whether the lunch offer is on.
 *
 * 2026-08-17 is a Monday. WEEKDAYS indexes: 0 = Monday … 6 = Sunday.
 */

const TZ = "Europe/Berlin";

function item(over: Partial<OfferItemFields> = {}): OfferItemFields {
  return {
    priceCents: 1200,
    offerPriceCents: 900,
    offerStartsAt: null,
    offerEndsAt: null,
    offerWeekly: null,
    ...over,
  };
}

/** Berlin local summer time → UTC instant (CEST = UTC+2). */
function berlin(dateHHMM: string): Date {
  const [d, hm] = dateHHMM.split(" ");
  return new Date(`${d}T${hm}:00+02:00`);
}

describe("offerActiveAt", () => {
  it("no offer price → never active", () => {
    expect(offerActiveAt(item({ offerPriceCents: null }), TZ, berlin("2026-08-17 12:00"))).toBe(
      false,
    );
  });

  it("a non-reduction never activates — the never-charge-more rule restated", () => {
    for (const bad of [0, -50, 1200, 1300]) {
      expect(offerActiveAt(item({ offerPriceCents: bad }), TZ, berlin("2026-08-17 12:00"))).toBe(
        false,
      );
    }
  });

  it("open-ended offer (no constraints) is always active", () => {
    expect(offerActiveAt(item(), TZ, berlin("2026-08-17 03:14"))).toBe(true);
  });

  it("date range: inactive before start, active inside, inactive after end", () => {
    const ranged = item({
      offerStartsAt: berlin("2026-08-17 00:00"),
      offerEndsAt: berlin("2026-08-23 23:59"),
    });
    expect(offerActiveAt(ranged, TZ, berlin("2026-08-16 12:00"))).toBe(false);
    expect(offerActiveAt(ranged, TZ, berlin("2026-08-20 12:00"))).toBe(true);
    expect(offerActiveAt(ranged, TZ, berlin("2026-08-24 12:00"))).toBe(false);
  });

  it("weekly lunch window Mon–Fri 11:30–14:00, Berlin clock", () => {
    const lunch = item({
      offerWeekly: { days: [0, 1, 2, 3, 4], start: "11:30", end: "14:00" },
    });
    // Monday 11:30 sharp (boundary) — active; 11:29 — not yet.
    expect(offerActiveAt(lunch, TZ, berlin("2026-08-17 11:30"))).toBe(true);
    expect(offerActiveAt(lunch, TZ, berlin("2026-08-17 11:29"))).toBe(false);
    // 13:59 active, 14:00 (exclusive end) not.
    expect(offerActiveAt(lunch, TZ, berlin("2026-08-17 13:59"))).toBe(true);
    expect(offerActiveAt(lunch, TZ, berlin("2026-08-17 14:00"))).toBe(false);
    // Saturday lunch — wrong day.
    expect(offerActiveAt(lunch, TZ, berlin("2026-08-22 12:00"))).toBe(false);
    // The venue's clock decides: 10:00 UTC IS 12:00 in Berlin — active.
    expect(offerActiveAt(lunch, TZ, new Date("2026-08-17T10:00:00Z"))).toBe(true);
  });

  it("midnight-crossing happy hour Fri 22:00–01:00: 23:59 and Saturday 00:30 both active", () => {
    const happy = item({ offerWeekly: { days: [4], start: "22:00", end: "01:00" } });
    expect(offerActiveAt(happy, TZ, berlin("2026-08-21 23:59"))).toBe(true); // Friday night
    expect(offerActiveAt(happy, TZ, berlin("2026-08-22 00:30"))).toBe(true); // Saturday small hours
    expect(offerActiveAt(happy, TZ, berlin("2026-08-22 01:00"))).toBe(false); // window closed
    expect(offerActiveAt(happy, TZ, berlin("2026-08-22 22:30"))).toBe(false); // Saturday evening — wrong start day
    expect(offerActiveAt(happy, TZ, berlin("2026-08-21 21:59"))).toBe(false); // not yet
  });

  it("date range AND weekly must both pass when both present", () => {
    const both = item({
      offerStartsAt: berlin("2026-08-17 00:00"),
      offerEndsAt: berlin("2026-08-18 23:59"),
      offerWeekly: { days: [0, 1, 2, 3, 4], start: "11:30", end: "14:00" },
    });
    expect(offerActiveAt(both, TZ, berlin("2026-08-17 12:00"))).toBe(true); // Monday lunch, in range
    expect(offerActiveAt(both, TZ, berlin("2026-08-17 15:00"))).toBe(false); // in range, outside window
    expect(offerActiveAt(both, TZ, berlin("2026-08-24 12:00"))).toBe(false); // right window, past range
  });

  it("a malformed weekly shape NARROWS to inactive, never widens to always-on", () => {
    for (const bad of [
      { days: [], start: "11:30", end: "14:00" },
      { days: [7], start: "11:30", end: "14:00" },
      { days: [0], start: "25:00", end: "14:00" },
      { days: [0], start: "11:30" },
      "lunch",
      42,
    ]) {
      expect(offerActiveAt(item({ offerWeekly: bad }), TZ, berlin("2026-08-17 12:00"))).toBe(false);
    }
  });

  it("does not throw across a DST transition day", () => {
    // Europe/Berlin fell back on 2026-10-25 (03:00 CEST → 02:00 CET).
    const lunch = item({
      offerWeekly: { days: [0, 1, 2, 3, 4, 5, 6], start: "02:00", end: "04:00" },
    });
    for (const iso of [
      "2026-10-25T00:30:00Z", // 02:30 CEST
      "2026-10-25T01:30:00Z", // 02:30 CET (the repeated hour)
      "2026-10-25T02:30:00Z", // 03:30 CET
    ]) {
      expect(() => offerActiveAt(lunch, TZ, new Date(iso))).not.toThrow();
    }
  });
});

describe("effectiveItemPrice / grace", () => {
  it("active offer → offer price with the base recorded; inactive → base with null", () => {
    expect(effectiveItemPrice(item(), TZ, berlin("2026-08-17 12:00"))).toEqual({
      unitPriceCents: 900,
      basePriceCents: 1200,
    });
    expect(
      effectiveItemPrice(item({ offerPriceCents: null }), TZ, berlin("2026-08-17 12:00")),
    ).toEqual({ unitPriceCents: 1200, basePriceCents: null });
  });

  it(`grace honours an offer that ended ${OFFER_GRACE_MINUTES - 1} min ago and refuses one ended ${OFFER_GRACE_MINUTES + 1} min ago`, () => {
    const ended = (minAgo: number) =>
      item({ offerEndsAt: new Date(berlin("2026-08-17 12:00").getTime() - minAgo * 60_000) });
    const now = berlin("2026-08-17 12:00");

    expect(effectiveItemPriceWithGrace(ended(OFFER_GRACE_MINUTES - 1), TZ, now)).toEqual({
      unitPriceCents: 900,
      basePriceCents: 1200,
    });
    expect(effectiveItemPriceWithGrace(ended(OFFER_GRACE_MINUTES + 1), TZ, now)).toEqual({
      unitPriceCents: 1200,
      basePriceCents: null,
    });
  });

  it("grace also covers a weekly window that just closed", () => {
    const lunch = item({
      offerWeekly: { days: [0, 1, 2, 3, 4], start: "11:30", end: "14:00" },
    });
    // 14:05 Monday: window shut 5 min ago — grace still prices the offer.
    expect(effectiveItemPriceWithGrace(lunch, TZ, berlin("2026-08-17 14:05"))).toEqual({
      unitPriceCents: 900,
      basePriceCents: 1200,
    });
    // 14:11 — past the grace: base price, no offer recorded.
    expect(effectiveItemPriceWithGrace(lunch, TZ, berlin("2026-08-17 14:11"))).toEqual({
      unitPriceCents: 1200,
      basePriceCents: null,
    });
  });
});

describe("parseOfferWeekly", () => {
  it("accepts the canonical shape and rejects everything else", () => {
    expect(parseOfferWeekly({ days: [0, 4], start: "11:30", end: "14:00" })).toEqual({
      days: [0, 4],
      start: "11:30",
      end: "14:00",
    });
    expect(parseOfferWeekly(null)).toBeNull();
    expect(parseOfferWeekly([1, 2])).toBeNull();
    expect(parseOfferWeekly({ days: [0], start: "9:00", end: "14:00" })).toBeNull(); // not HH:MM
  });
});
