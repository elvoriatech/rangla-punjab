import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Loader for the operator runbooks under `src/content/runbooks/*.mdx`.
 * Files are read verbatim (no MDX compile) — the runbook page (P2-5)
 * renders section text inside `<pre>` tags so the operator sees the
 * exact prose the on-call playbook expects, no markdown-to-JSX
 * transform surprises. If we ever need rich rendering, the file
 * shape can be piped through `@next/mdx` — but plain text is
 * cognitively cheaper at 3am.
 */

export const RUNBOOK_NAMES = [
  "queue-backlog",
  "db-saturation",
  "cache-hit-drop",
  "backup-failure",
  "error-rate-spike",
  "restore-drill",
] as const;

export type RunbookName = (typeof RUNBOOK_NAMES)[number];

export const RUNBOOK_DIR = path.join("src", "content", "runbooks");

export const REQUIRED_SECTIONS = ["What", "Impact", "First steps", "Escalation"] as const;

export interface RunbookSection {
  heading: string;
  body: string;
}

export interface Runbook {
  name: RunbookName;
  title: string;
  sections: RunbookSection[];
}

export async function readRunbook(name: RunbookName, dir = RUNBOOK_DIR): Promise<Runbook> {
  const raw = await readFile(path.join(dir, `${name}.mdx`), "utf8");
  return parseRunbook(name, raw);
}

export async function listRunbooks(dir = RUNBOOK_DIR): Promise<Runbook[]> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""));
  const known = files.filter((n): n is RunbookName =>
    (RUNBOOK_NAMES as readonly string[]).includes(n),
  );
  return Promise.all(known.sort().map((n) => readRunbook(n, dir)));
}

export function parseRunbook(name: string, raw: string): Runbook {
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? name;

  const sections: RunbookSection[] = [];
  const lines = raw.split("\n");
  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
      }
      currentHeading = h2[1]!.trim();
      currentBody = [];
    } else if (currentHeading !== null) {
      currentBody.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
  }

  return { name: name as RunbookName, title, sections };
}
