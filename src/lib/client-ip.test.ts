import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

function req(headers: Record<string, string>): Request {
  return new Request("http://example.com/", { headers });
}

describe("clientIp", () => {
  it("prefers CF-Connecting-IP when present", () => {
    expect(
      clientIp(req({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "10.0.0.1" })),
    ).toBe("203.0.113.5");
  });

  it("falls back to the leftmost X-Forwarded-For entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.7, 10.0.0.1, 10.0.0.2" }))).toBe(
      "198.51.100.7",
    );
  });

  it("trims whitespace around the leftmost XFF entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "   198.51.100.7  ,10.0.0.1" }))).toBe("198.51.100.7");
  });

  it("returns the 0.0.0.0 placeholder when no proxy headers are present", () => {
    expect(clientIp(req({}))).toBe("0.0.0.0");
  });
});
