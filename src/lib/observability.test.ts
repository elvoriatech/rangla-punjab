import { afterEach, describe, expect, it, vi } from "vitest";
import { captureException } from "./observability";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureException", () => {
  it("emits a structured error line with the request context", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    captureException(new Error("boom"), {
      requestId: "r-3",
      tenantId: "t-3",
      path: "/x",
      method: "GET",
    });
    const parsed = JSON.parse(String(spy.mock.calls[0]![0]).trim());
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("boom");
    expect(parsed.requestId).toBe("r-3");
    expect(parsed.tenantId).toBe("t-3");
    expect(parsed.path).toBe("/x");
    expect((parsed.err as { message: string }).message).toBe("boom");
    expect(typeof (parsed.err as { stack: string }).stack).toBe("string");
  });

  it("coerces non-Error throws to a string message", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    captureException("plain string throw");
    const parsed = JSON.parse(String(spy.mock.calls[0]![0]).trim());
    expect(parsed.msg).toBe("plain string throw");
    expect((parsed.err as { message: string }).message).toBe("plain string throw");
  });
});
