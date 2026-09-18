import { describe, expect, it } from "vitest";
import { isStaleBuildError } from "./stale-build";

describe("isStaleBuildError", () => {
  it("recognises the errors a tab shows after a deploy", () => {
    expect(
      isStaleBuildError(
        'Failed to find Server Action "40d870323d". This request might be from an older or newer deployment.',
      ),
    ).toBe(true);
    expect(isStaleBuildError("ChunkLoadError: Loading chunk 4521 failed.")).toBe(true);
    expect(isStaleBuildError("Failed to fetch dynamically imported module: /_next/x.js")).toBe(
      true,
    );
  });
  it("leaves real application errors alone", () => {
    expect(isStaleBuildError("user abc has no active tenant")).toBe(false);
    expect(isStaleBuildError("")).toBe(false);
    expect(isStaleBuildError(undefined)).toBe(false);
  });
});
