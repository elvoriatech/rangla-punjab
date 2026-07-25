import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password (Argon2id)", () => {
  it("produces an argon2id envelope and round-trips verify", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword(hash, "hunter3")).toBe(false);
  });

  it("returns false (not throw) for a malformed stored hash", async () => {
    expect(await verifyPassword("not-a-real-argon2-hash", "anything")).toBe(false);
  });
});
