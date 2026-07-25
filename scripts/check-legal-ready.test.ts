import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkLegalReady, MARKER } from "./check-legal-ready";

describe("checkLegalReady", () => {
  it("exits dirty against the real placeholders — every mdx file carries the marker", async () => {
    // Against the current repo state we expect *every* legal MDX file to
    // carry the marker (placeholders shipped with P1-22a).
    const result = await checkLegalReady();
    expect(result.clean).toBe(false);
    expect(result.offenders.length).toBe(result.scanned.length);
    // Sanity: exactly the five pages P1-22a set up.
    expect(result.scanned.length).toBe(5);
    expect(result.scanned.every((p) => p.endsWith(".mdx"))).toBe(true);
  });

  describe("scratch fixtures", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "legal-ready-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("returns clean when no MDX file carries the marker", async () => {
      await writeFile(path.join(dir, "terms.mdx"), "# Terms\n\nReal counsel-authored copy.\n");
      await writeFile(path.join(dir, "privacy.mdx"), "# Privacy\n\nReal counsel-authored copy.\n");
      const result = await checkLegalReady(dir);
      expect(result.clean).toBe(true);
      expect(result.offenders).toEqual([]);
      expect(result.scanned).toHaveLength(2);
    });

    it("returns dirty when even one file still carries the marker", async () => {
      await writeFile(path.join(dir, "terms.mdx"), `# Terms\n\n{/* ${MARKER} */}\n\nCopy.\n`);
      await writeFile(path.join(dir, "privacy.mdx"), "# Privacy\n\nClean copy.\n");
      const result = await checkLegalReady(dir);
      expect(result.clean).toBe(false);
      expect(result.offenders).toHaveLength(1);
      expect(result.offenders[0]).toContain("terms.mdx");
    });

    it("ignores non-MDX files in the directory", async () => {
      // A stray README shouldn't count.
      await writeFile(path.join(dir, "README.md"), `# Directory notes — ${MARKER}\n`);
      await writeFile(path.join(dir, "terms.mdx"), "# Terms\n\nCounsel-signed copy.\n");
      const result = await checkLegalReady(dir);
      expect(result.clean).toBe(true);
      expect(result.scanned.every((f) => f.endsWith(".mdx"))).toBe(true);
    });
  });
});
