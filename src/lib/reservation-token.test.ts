import { describe, expect, it } from "vitest";
import { signReceiptToken } from "./receipt-token";
import { signReservationToken, verifyReservationToken } from "./reservation-token";

/**
 * The reservation token is the anonymous guest's whole credential for
 * reading one table request back, so the properties below are the
 * security boundary, not nice-to-haves.
 */
describe("reservation tokens", () => {
  it("round-trips the reservation and its tenant", () => {
    const token = signReservationToken("res_1", "tenant_1");
    expect(verifyReservationToken(token)).toEqual({
      reservationId: "res_1",
      tenantId: "tenant_1",
    });
  });

  it("rejects a tampered payload, a tampered signature and junk", () => {
    const token = signReservationToken("res_1", "tenant_1");
    const [encoded, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        r: "res_2",
        t: "tenant_1",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");

    expect(verifyReservationToken(`${forgedPayload}.${signature}`)).toBeNull();
    expect(verifyReservationToken(`${encoded}.${"A".repeat(43)}`)).toBeNull();
    expect(verifyReservationToken("")).toBeNull();
    expect(verifyReservationToken("no-dot")).toBeNull();
  });

  it("refuses an expired token", () => {
    expect(verifyReservationToken(signReservationToken("res_1", "tenant_1", -1))).toBeNull();
  });

  it("is domain-separated from receipt tokens", () => {
    // Same secret, same payload shape, different HMAC tag: an order
    // receipt link must never read a reservation, or vice versa.
    expect(verifyReservationToken(signReceiptToken("res_1", "tenant_1"))).toBeNull();
  });
});
