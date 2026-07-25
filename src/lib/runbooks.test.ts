import { describe, expect, it } from "vitest";
import {
  RUNBOOK_NAMES,
  REQUIRED_SECTIONS,
  listRunbooks,
  parseRunbook,
  readRunbook,
} from "./runbooks";

describe("runbook content lint (P2-5)", () => {
  it("has exactly the five named runbook files on disk", async () => {
    const runbooks = await listRunbooks();
    expect(runbooks.map((r) => r.name).sort()).toEqual([...RUNBOOK_NAMES].sort());
  });

  it.each(RUNBOOK_NAMES)(
    "%s carries H1 + What/Impact/First steps/Escalation sections",
    async (name) => {
      const rb = await readRunbook(name);
      expect(rb.title).toBeTruthy();
      const headings = rb.sections.map((s) => s.heading);
      for (const required of REQUIRED_SECTIONS) {
        expect(headings, `${name}.mdx missing ## ${required}`).toContain(required);
      }
      // Every required section carries real prose, not an empty stub.
      for (const s of rb.sections) {
        if ((REQUIRED_SECTIONS as readonly string[]).includes(s.heading)) {
          expect(s.body.length, `${name}.mdx › ${s.heading} is empty`).toBeGreaterThan(50);
        }
      }
    },
  );

  it("parseRunbook rejects nothing but a missing H1 falls back to the file name", () => {
    const bad = parseRunbook(
      "no-title",
      "## What\nbody\n## Impact\nbody\n## First steps\nb\n## Escalation\nb",
    );
    expect(bad.title).toBe("no-title");
    expect(bad.sections.map((s) => s.heading)).toEqual([
      "What",
      "Impact",
      "First steps",
      "Escalation",
    ]);
  });
});
