import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts validates process.env at import time, so each case re-imports fresh.
describe("env loader", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("throws a clear error when a required var is missing", async () => {
    delete process.env.APP_DATABASE_URL;
    await expect(import("./env")).rejects.toThrow(/Invalid environment configuration/);
  });

  it("parses a valid environment", async () => {
    const mod = await import("./env");
    expect(mod.env.APP_DATABASE_URL).toBeTruthy();
  });
});
