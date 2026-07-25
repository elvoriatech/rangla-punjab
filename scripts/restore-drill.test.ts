import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The drill talks to the running elvoria-postgres container (creates
// a scratch DB, runs migrations, seeds, checksums, drops the DB), so
// this test needs the docker-compose stack up — same requirement as
// every other integration test in this suite. Runs in ~10-15s.

describe("restore-drill script (P2-7)", () => {
  const repoRoot = path.resolve(process.cwd());
  const scriptPath = path.join(repoRoot, "scripts", "restore-drill.ts");
  const goldenPath = path.join(repoRoot, "scripts", "restore-drill.golden.json");
  const fixturePath = path.join(repoRoot, "prisma", "fixtures", "demo.sql");

  it("exits 0 against prisma/fixtures/demo.sql and the checksum matches the golden", () => {
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", scriptPath, "--fixture", fixturePath, "--golden", goldenPath],
      { cwd: repoRoot, env: process.env, encoding: "utf8" },
    );
    // `stdio: "inherit"` inside the script means the driller writes
    // directly to *this* process's streams; the child's own stdout is
    // proxied but empty. Exit code 0 is the contract.
    expect(result.status).toBe(0);
  }, 120_000);

  it("has a committed golden file with itemCount + itemsChecksum", async () => {
    const raw = await readFile(goldenPath, "utf8");
    const parsed = JSON.parse(raw) as { itemCount: number; itemsChecksum: string };
    expect(typeof parsed.itemCount).toBe("number");
    expect(parsed.itemCount).toBeGreaterThan(0);
    expect(parsed.itemsChecksum).toMatch(/^[a-f0-9]{32}$/);
  });

  it("has an entry in the runbooks catalogue linking to the docs page", async () => {
    // P2-5 asserts every RUNBOOK_NAMES entry has a matching mdx file
    // with the four required sections. Adding `restore-drill` to that
    // list is the "runbook page links to the script" bit from the
    // P2-7 verify — the P2-5 test suite covers the section shape.
    const { RUNBOOK_NAMES } = await import("../src/lib/runbooks");
    expect(RUNBOOK_NAMES).toContain("restore-drill");
  });
});
