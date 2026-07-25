import { describe, expect, it } from "vitest";
import { hashToken, issueToken } from "./tokens";

describe("one-shot tokens", () => {
  it("produces a base64url plaintext of 43 chars (32 bytes) and a matching hash", () => {
    const t = issueToken();
    expect(t.plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(t.plaintext)).toBe(t.hash);
  });

  it("hashes are deterministic and hex sha256", () => {
    const h = hashToken("abc");
    // Known SHA-256 of "abc"
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("two issued tokens do not collide", () => {
    const a = issueToken();
    const b = issueToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});
