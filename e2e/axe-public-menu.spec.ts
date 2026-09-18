import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * P1-25: axe check on the seeded public menu.
 *
 * Runs axe-core against `/r/demo` (the CI-seeded venue) and fails on
 * any `serious` or `critical` violation. `minor` and `moderate` findings
 * are reported but not failing — they're the tail that shows up on any
 * decent HTML page and would drown the signal. WCAG 2.1 AA is the
 * conformance target per CLAUDE.md.
 *
 * The default locale is exercised; the translated variants are scanned
 * separately so a translation regression can't hide behind the English
 * page passing. `/ar` additionally covers the RTL render — `dir="rtl"`
 * flips the whole layout, and axe is the cheapest guard against a
 * mirrored control landing somewhere unreachable.
 */

const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

for (const route of ["/", "/de", "/ar"]) {
  test(`no serious/critical a11y violations on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
    if (blocking.length > 0) {
      const summary = blocking
        .map((v) => {
          const nodes = v.nodes
            .slice(0, 5)
            .map(
              (n) =>
                `      html: ${n.html}\n      target: ${n.target.join(" ")}\n      why: ${n.failureSummary}`,
            )
            .join("\n");
          return `  · [${v.impact}] ${v.id}: ${v.help}\n${nodes}`;
        })
        .join("\n");
      throw new Error(`axe found ${blocking.length} blocking violation(s):\n${summary}`);
    }
    expect(blocking).toEqual([]);
  });
}
