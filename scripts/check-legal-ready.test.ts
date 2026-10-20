import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkLegalReady, MARKER } from "./check-legal-ready";

describe("checkLegalReady", () => {
  it("is clean against the real legal pages — the owner signed them off (2026-10-20)", async () => {
    const result = await checkLegalReady();
    expect(result.clean).toBe(true);
    expect(result.offenders).toEqual([]);
    // Impressum, Datenschutz, AGB, Barrierefreiheit (the SaaS DPA is gone).
    expect(result.scanned.length).toBe(4);
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
