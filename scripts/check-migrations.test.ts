import { mkdtemp, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkMigrations, DANGEROUS_PATTERNS } from "./check-migrations";

const FIXTURES_ROOT = path.join(process.cwd(), "scripts", "fixtures", "check-migrations");

// Helper: build a scratch migrations dir with a subset of the fixture
// migrations copied in, in the requested order. Order matters — the
// "predecessor marker" rule reads the alphabetical predecessor.
async function scratchDir(migrations: readonly string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "check-migrations-"));
  for (const name of migrations) {
    const dest = path.join(dir, name);
    await mkdir(dest, { recursive: true });
    await cp(path.join(FIXTURES_ROOT, name, "migration.sql"), path.join(dest, "migration.sql"));
  }
  return dir;
}

describe("checkMigrations (P2-8)", () => {
  it("passes a plain additive migration (CREATE TABLE, ADD COLUMN NULLABLE, CREATE INDEX)", async () => {
    const dir = await scratchDir(["01_additive"]);
    try {
      const result = await checkMigrations(dir);
      expect(result.clean).toBe(true);
      expect(result.offenses).toEqual([]);
      expect(result.scanned).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a NOT NULL added without an expand-contract predecessor", async () => {
    const dir = await scratchDir(["01_additive", "02_bad_not_null"]);
    try {
      const result = await checkMigrations(dir);
      expect(result.clean).toBe(false);
      expect(result.offenses).toHaveLength(1);
      const o = result.offenses[0]!;
      expect(o.migration).toBe("02_bad_not_null");
      expect(o.pattern).toBe("SET NOT NULL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes an expand-contract pair (marker on predecessor + destructive follow-up)", async () => {
    const dir = await scratchDir(["03_expand_backfill", "04_contract_not_null"]);
    try {
      const result = await checkMigrations(dir);
      expect(result.clean).toBe(true);
      expect(result.offenses).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes when the destructive line trails an inline safe marker on the same line", async () => {
    const dir = await scratchDir(["05_inline_safe"]);
    try {
      const result = await checkMigrations(dir);
      expect(result.clean).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("catches every destructive pattern class the task line calls out", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "check-migrations-"));
    try {
      await mkdir(path.join(dir, "20260101_kitchen_sink"));
      await writeFile(
        path.join(dir, "20260101_kitchen_sink", "migration.sql"),
        [
          `DROP TABLE "widgets";`,
          `ALTER TABLE "widgets" DROP COLUMN "name";`,
          `ALTER TABLE "widgets" ALTER COLUMN "priority" TYPE bigint;`,
          `ALTER TABLE "widgets" ALTER COLUMN "priority" SET NOT NULL;`,
        ].join("\n"),
      );
      const result = await checkMigrations(dir);
      expect(result.clean).toBe(false);
      const patterns = result.offenses.map((o) => o.pattern).sort();
      expect(patterns).toEqual(DANGEROUS_PATTERNS.map((p) => p.name).sort());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes against the real prisma/migrations directory (guards existing history)", async () => {
    const result = await checkMigrations();
    if (!result.clean) {
      // Rich failure detail so a future migration that trips the gate
      // shows up in the CI log rather than a bare boolean.
      const lines = result.offenses
        .map((o) => `${o.migration}:${o.line} [${o.pattern}] ${o.text}`)
        .join("\n");
      throw new Error(`real migrations tripped the checker:\n${lines}`);
    }
    expect(result.clean).toBe(true);
    expect(result.scanned.length).toBeGreaterThan(0);
  });
});
