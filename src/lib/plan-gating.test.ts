import { describe, expect, it } from "vitest";
import { checkCap, type CappedResource } from "./plan-gating";

/**
 * White-label, single restaurant: there are no plan caps. `checkCap` is a
 * no-op that always allows, so the write routes still calling it never
 * block. (The function is retained only until those call sites are
 * cleaned up.)
 */
describe("plan-gating checkCap (no caps in single-restaurant mode)", () => {
  const resources: CappedResource[] = ["venues", "menus", "items"];

  it("always allows, for every capped resource, regardless of usage", async () => {
    for (const resource of resources) {
      const cap = await checkCap("any-user-id", resource);
      expect(cap.allowed).toBe(true);
      expect(cap.planCode).toBe("support");
      expect(cap.limit).toBe(Number.POSITIVE_INFINITY);
    }
  });
});
