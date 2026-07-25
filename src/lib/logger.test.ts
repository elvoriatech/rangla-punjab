import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, getRequestContext, logger, runWithRequestContext } from "./logger";

// The logger writes directly to process.stdout / process.stderr so container
// runtimes see one JSON line per event. Tests spy on those streams; there is
// no in-memory buffer to inspect otherwise.

function spyStream(stream: NodeJS.WriteStream) {
  return vi.spyOn(stream, "write").mockImplementation(() => true);
}

function lastLine(spy: ReturnType<typeof spyStream>) {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error("no write recorded");
  return JSON.parse(String(call[0]).trim());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("structured logger", () => {
  it("emits one JSON line per event with ts/level/msg", () => {
    const spy = spyStream(process.stdout);
    createLogger().info("hello", { requestId: "r-1" });
    const parsed = lastLine(spy);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.requestId).toBe("r-1");
    expect(typeof parsed.ts).toBe("string");
    expect(() => new Date(parsed.ts as string).toISOString()).not.toThrow();
  });

  it("routes warn/error to stderr and info/debug to stdout", () => {
    const out = spyStream(process.stdout);
    const err = spyStream(process.stderr);
    const log = createLogger();
    log.info("i");
    log.debug("d");
    log.warn("w");
    log.error("e");
    expect(out.mock.calls).toHaveLength(2);
    expect(err.mock.calls).toHaveLength(2);
  });

  it("redacts sensitive keys at any nesting depth", () => {
    const spy = spyStream(process.stdout);
    createLogger().info("attempt", {
      email: "user@example.com",
      password: "hunter2",
      nested: { token: "abc", ok: true },
      ok: true,
    });
    const parsed = lastLine(spy);
    expect(parsed.email).toBe("[redacted]");
    expect(parsed.password).toBe("[redacted]");
    expect((parsed.nested as { token: unknown; ok: unknown }).token).toBe("[redacted]");
    expect((parsed.nested as { token: unknown; ok: unknown }).ok).toBe(true);
    expect(parsed.ok).toBe(true);
  });

  it("child logger inherits and can extend base context", () => {
    const spy = spyStream(process.stdout);
    createLogger({ requestId: "r-2" }).child({ tenantId: "t-2" }).info("bound", { extra: 1 });
    const parsed = lastLine(spy);
    expect(parsed.requestId).toBe("r-2");
    expect(parsed.tenantId).toBe("t-2");
    expect(parsed.extra).toBe(1);
  });
});

describe("runWithRequestContext (P2-1)", () => {
  it("propagates request context to a nested service call without passing it explicitly", async () => {
    const spy = spyStream(process.stdout);
    // Simulate an authed API route handler: outer scope binds
    // request-id + tenant-id + user-id, the "nested service" only
    // gets called — no explicit binding — and its emit still carries
    // every field.
    async function nestedService(): Promise<void> {
      // Prove ALS visibility without touching the logger.
      const ctx = getRequestContext();
      expect(ctx.requestId).toBe("r-nested");
      expect(ctx.tenantId).toBe("t-nested");
      logger.info("nested.op");
    }
    await runWithRequestContext(
      {
        requestId: "r-nested",
        tenantId: "t-nested",
        userId: "u-nested",
        route: "/api/items",
        method: "POST",
      },
      async () => {
        await nestedService();
      },
    );
    const parsed = lastLine(spy);
    expect(parsed.requestId).toBe("r-nested");
    expect(parsed.tenantId).toBe("t-nested");
    expect(parsed.userId).toBe("u-nested");
    expect(parsed.route).toBe("/api/items");
    expect(parsed.method).toBe("POST");
  });

  it("does not leak context between two concurrent requests", async () => {
    const spy = spyStream(process.stdout);
    // Force interleaving so if ALS were a plain closure/global the two
    // scopes would clobber each other.
    async function work(id: string): Promise<Record<string, unknown>> {
      return runWithRequestContext({ requestId: id, tenantId: `t-${id}` }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        logger.info("concurrent.op");
        // Also verify the ALS view is correct at the leaf.
        const ctx = getRequestContext();
        return { requestId: ctx.requestId as string, tenantId: ctx.tenantId as string };
      });
    }
    const [a, b] = await Promise.all([work("a"), work("b")]);
    expect(a).toEqual({ requestId: "a", tenantId: "t-a" });
    expect(b).toEqual({ requestId: "b", tenantId: "t-b" });
    // Both requests emitted their own line with their own id — no cross-talk.
    const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0]).trim()));
    const rows = lines.filter((l) => l.msg === "concurrent.op");
    expect(rows).toHaveLength(2);
    const ids = new Set(rows.map((r) => r.requestId));
    expect(ids).toEqual(new Set(["a", "b"]));
    for (const r of rows) expect(r.tenantId).toBe(`t-${r.requestId}`);
  });

  it("caller-supplied fields override the ALS-carried ones (explicit wins)", async () => {
    const spy = spyStream(process.stdout);
    await runWithRequestContext({ requestId: "r-outer", tenantId: "t-outer" }, async () => {
      logger.info("override", { tenantId: "t-explicit" });
    });
    const parsed = lastLine(spy);
    expect(parsed.requestId).toBe("r-outer");
    expect(parsed.tenantId).toBe("t-explicit");
  });

  it("emits without ALS context set (outside a request scope)", () => {
    const spy = spyStream(process.stdout);
    // No `runWithRequestContext` wrapper — should still work, just no
    // requestId field present.
    logger.info("bare");
    const parsed = lastLine(spy);
    expect(parsed.msg).toBe("bare");
    expect(parsed.requestId).toBeUndefined();
  });
});
