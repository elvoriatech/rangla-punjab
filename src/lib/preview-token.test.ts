import { describe, expect, it } from "vitest";
import { signPreviewToken, verifyPreviewToken } from "./preview-token";
import { signSession } from "./session";

describe("preview token", () => {
  it("round-trips (tenantId, venueId) through sign/verify", () => {
    const token = signPreviewToken("t-1", "v-1");
    const parsed = verifyPreviewToken(token);
    expect(parsed?.tenantId).toBe("t-1");
    expect(parsed?.venueId).toBe("v-1");
    expect(parsed?.expiresAt).toBeInstanceOf(Date);
    expect(parsed!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered payload", () => {
    const token = signPreviewToken("t-1", "v-1");
    const [encoded, sig] = token.split(".");
    const decoded = Buffer.from(encoded!, "base64url").toString("utf8");
    const tampered = decoded.replace("t-1", "t-EVIL");
    const forged = `${Buffer.from(tampered).toString("base64url")}.${sig}`;
    expect(verifyPreviewToken(forged)).toBeNull();
  });

  it("rejects a token whose expiry has passed", () => {
    const token = signPreviewToken("t-1", "v-1", 0);
    expect(verifyPreviewToken(token)).toBeNull();
  });

  it("rejects a session cookie as a preview token (domain separation)", () => {
    // Session tokens use the same HMAC secret but a different HMAC input
    // prefix. A raw session token must not verify as a preview token.
    const session = signSession("user-1");
    expect(verifyPreviewToken(session)).toBeNull();
  });

  it("rejects malformed input (no dot, junk, empty)", () => {
    expect(verifyPreviewToken("")).toBeNull();
    expect(verifyPreviewToken("noseparator")).toBeNull();
    expect(verifyPreviewToken(".only-sig")).toBeNull();
    expect(verifyPreviewToken("only-payload.")).toBeNull();
  });
});
