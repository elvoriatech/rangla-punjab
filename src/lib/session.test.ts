import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./session";

describe("session token", () => {
  it("round-trips a userId through sign/verify", () => {
    const token = signSession("user-123");
    const parsed = verifySession(token);
    expect(parsed?.userId).toBe("user-123");
    expect(parsed?.expiresAt).toBeInstanceOf(Date);
    expect(parsed!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered payload", () => {
    const token = signSession("user-A");
    const [encoded, sig] = token.split(".");
    // Flip a byte in the payload — signature is over the original payload,
    // so verification must fail.
    const tampered = Buffer.from(encoded, "base64url").toString("utf8").replace("user-A", "user-B");
    const forged = `${Buffer.from(tampered).toString("base64url")}.${sig}`;
    expect(verifySession(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signSession("user-A");
    const [encoded] = token.split(".");
    const forged = `${encoded}.${Buffer.from("bogus").toString("base64url")}`;
    expect(verifySession(forged)).toBeNull();
  });

  it("rejects an expired token", () => {
    // TTL 0 → expiry is `Math.floor(now/1000)` seconds, i.e. already in the past.
    const token = signSession("user-A", 0);
    expect(verifySession(token)).toBeNull();
  });

  it("rejects malformed tokens (no dot, empty parts, junk)", () => {
    expect(verifySession("")).toBeNull();
    expect(verifySession("noseparator")).toBeNull();
    expect(verifySession(".only-sig")).toBeNull();
    expect(verifySession("only-payload.")).toBeNull();
    expect(verifySession("!!!.???")).toBeNull();
  });
});
