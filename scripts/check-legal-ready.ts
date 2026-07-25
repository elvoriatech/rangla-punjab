import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Release-checklist gate for the legal MDX files. Scans every `.mdx`
 * under `src/content/legal` for the string `TODO: legal review`. Any
 * hit means counsel hasn't cleared that page for release.
 *
 * Advisory today (`continue-on-error: true` in CI); flips to blocking
 * with P1-30 when we exit the MVP smoke gate.
 */

export const MARKER = "TODO: legal review";
export const DEFAULT_DIR = path.join("src", "content", "legal");

export interface CheckResult {
  /** True when every file is clean. */
  clean: boolean;
  /** One entry per file that still carries the marker. */
  offenders: string[];
  /** File paths inspected, in stable (sorted) order. */
  scanned: string[];
}

export async function checkLegalReady(dir = DEFAULT_DIR): Promise<CheckResult> {
  const entries = (await readdir(dir)).filter((e) => e.endsWith(".mdx")).sort();
  const offenders: string[] = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    const text = await readFile(full, "utf8");
    if (text.includes(MARKER)) offenders.push(full);
  }
  return {
    clean: offenders.length === 0,
    offenders,
    scanned: entries.map((e) => path.join(dir, e)),
  };
}

// ---------- CLI entrypoint ----------

async function main(): Promise<void> {
  const result = await checkLegalReady();
  if (result.clean) {
    process.stdout.write(`✓ legal-ready: ${result.scanned.length} MDX files clean\n`);
    process.exit(0);
  }
  process.stderr.write(
    `✗ legal-ready: ${result.offenders.length}/${result.scanned.length} MDX file(s) still carry "${MARKER}":\n`,
  );
  for (const o of result.offenders) process.stderr.write(`   • ${o}\n`);
  process.stderr.write(
    `\nRemove the marker from each file once counsel has signed off (P1-22c).\n`,
  );
  process.exit(1);
}

// Execute only when invoked directly, not on import for tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main();
}
