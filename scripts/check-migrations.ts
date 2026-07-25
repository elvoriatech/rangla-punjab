import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * P2-8 reviewed-migration gate. Walks every
 * prisma/migrations/star/migration.sql and rejects destructive-shape
 * operations (DROP TABLE / DROP COLUMN / ALTER COLUMN TYPE /
 * SET NOT NULL) unless one of three things is true:
 *
 * 1. Whole-file expand-contract marker: the migration itself opens
 *    with the -- migration:expand-contract comment as a top-of-file
 *    line, meaning "this file did its own data-fill earlier and all
 *    destructive lines below are safe".
 * 2. Predecessor expand-contract marker: the previous migration (by
 *    lexicographic timestamp order) carries the whole-file marker,
 *    meaning "the expand step ran there, this migration is the
 *    paired contract". This matches the classic expand then migrate
 *    data then contract sequence.
 * 3. Inline safe marker: the destructive line's trailing comment
 *    contains -- migration:safe, meaning "this specific line is
 *    provably harmless" (e.g. widening text to citext, where the
 *    new type is a superset of the old and no data-fill is needed).
 *
 * Wired into the CI lint step so a PR that introduces an unpaired
 * destructive migration fails at review time. CLI:
 *
 *   pnpm check:migrations
 */

export const DEFAULT_MIGRATIONS_DIR = path.join("prisma", "migrations");

export const WHOLE_FILE_MARKER = "-- migration:expand-contract";
export const INLINE_SAFE_MARKER = "-- migration:safe";

export interface DangerousPattern {
  name: string;
  re: RegExp;
}

export const DANGEROUS_PATTERNS: readonly DangerousPattern[] = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { name: "ALTER COLUMN TYPE", re: /\bALTER\s+COLUMN\s+[^;]*?\s+TYPE\b/i },
  { name: "SET NOT NULL", re: /\bSET\s+NOT\s+NULL\b/i },
];

export interface Offense {
  migration: string;
  line: number;
  pattern: string;
  text: string;
}

export interface CheckResult {
  clean: boolean;
  offenses: Offense[];
  scanned: string[];
}

export async function checkMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<CheckResult> {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const offenses: Offense[] = [];
  const scanned: string[] = [];
  const markerByMigration = new Map<string, boolean>();

  for (const name of entries) {
    const filePath = path.join(dir, name, "migration.sql");
    let sql: string;
    try {
      sql = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    markerByMigration.set(name, hasWholeFileMarker(sql));
  }

  for (let i = 0; i < entries.length; i += 1) {
    const name = entries[i]!;
    const filePath = path.join(dir, name, "migration.sql");
    let sql: string;
    try {
      sql = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    scanned.push(filePath);

    const wholeFileOk = markerByMigration.get(name) === true;
    const prev = i > 0 ? entries[i - 1] : null;
    const predecessorOk = prev ? markerByMigration.get(prev) === true : false;

    const lines = sql.split("\n");
    for (let ln = 0; ln < lines.length; ln += 1) {
      const line = lines[ln]!;
      const trimmed = line.trim();
      if (trimmed.startsWith("--") || trimmed === "") continue;

      for (const pattern of DANGEROUS_PATTERNS) {
        if (!pattern.re.test(line)) continue;
        if (wholeFileOk) break;
        if (predecessorOk) break;
        if (line.includes(INLINE_SAFE_MARKER)) break;
        offenses.push({
          migration: name,
          line: ln + 1,
          pattern: pattern.name,
          text: trimmed,
        });
        break;
      }
    }
  }

  return { clean: offenses.length === 0, offenses, scanned };
}

function hasWholeFileMarker(sql: string): boolean {
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (!trimmed.startsWith("--")) return false;
    if (trimmed === WHOLE_FILE_MARKER) return true;
  }
  return false;
}

// ---------- CLI entrypoint ---------------------------------------------

async function main(): Promise<void> {
  const result = await checkMigrations();
  if (result.clean) {
    process.stdout.write(
      "OK check-migrations: " + String(result.scanned.length) + " migration file(s) clean\n",
    );
    process.exit(0);
  }
  process.stderr.write(
    "FAIL check-migrations: " + String(result.offenses.length) + " unpaired destructive op(s):\n",
  );
  for (const o of result.offenses) {
    process.stderr.write(
      "  - " + o.migration + ":" + String(o.line) + " [" + o.pattern + "] " + o.text + "\n",
    );
  }
  const hint = [
    "",
    "Each destructive line must be preceded by an expand-contract migration",
    "(whole-file " + WHOLE_FILE_MARKER + " comment on the previous migration),",
    "carry a top-of-file " + WHOLE_FILE_MARKER + " comment itself, or trail an",
    "inline " + INLINE_SAFE_MARKER + " comment on the same SQL line.",
    "",
  ].join("\n");
  process.stderr.write(hint);
  process.exit(1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main();
}
