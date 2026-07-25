import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUBPROCESSORS } from "@/content/legal/subprocessors";

/**
 * Legal-page tests. Rendering `.mdx` requires Next's compiler; vitest
 * lacks that transform. So we inspect the raw file contents to prove
 * each page carries a `meta` export + the TODO-review banner is baked
 * into the shared LegalLayout (the layout render is covered separately
 * by the smoke curl to the running dev server, noted in the commit).
 */

const LEGAL_FILES = ["terms", "privacy", "dpa", "impressum", "accessibility"] as const;

async function readLegalMdx(name: string): Promise<string> {
  const file = path.join(process.cwd(), "src/content/legal", `${name}.mdx`);
  return readFile(file, "utf8");
}

describe("legal MDX content files", () => {
  it.each(LEGAL_FILES)("%s.mdx exports meta.title + meta.lastUpdated", async (name) => {
    const src = await readLegalMdx(name);
    // `export const meta = { title: "...", lastUpdated: "YYYY-MM-DD" }`
    // The `-draft` suffix is allowed while P1-22c-ii is still open; counsel
    // strips it when they sign off on the page.
    const metaMatch = src.match(/export const meta\s*=\s*\{([\s\S]*?)\}/);
    expect(metaMatch).not.toBeNull();
    const body = metaMatch![1]!;
    expect(body).toMatch(/title:\s*"[^"]+"/);
    expect(body).toMatch(/lastUpdated:\s*"\d{4}-\d{2}-\d{2}(-draft)?"/);
  });

  it.each(LEGAL_FILES)("%s.mdx carries substantive placeholder copy", async (name) => {
    const src = await readLegalMdx(name);
    // Everything past the `export` block should have real headings.
    expect(src).toMatch(/^## /m);
  });

  it.each(LEGAL_FILES)("%s.mdx retains the release marker until counsel signs", async (name) => {
    const src = await readLegalMdx(name);
    expect(src).toContain("TODO: legal review");
  });

  it.each(LEGAL_FILES)("%s.mdx has at least 4 `##` headings", async (name) => {
    const src = await readLegalMdx(name);
    const headings = src.match(/^## /gm) ?? [];
    expect(headings.length).toBeGreaterThanOrEqual(4);
  });

  it.each(LEGAL_FILES)("%s.mdx has at least 800 characters of body text", async (name) => {
    const src = await readLegalMdx(name);
    // Body = everything after the closing brace of the `meta` export.
    // Strip: the top-of-file HTML/MDX comment, any `import` lines, and the
    // `export const meta = { ... }` block itself, then measure what remains.
    const body = src
      .replace(/^\{\/\*[\s\S]*?\*\/\}\s*/m, "")
      .replace(/^import[^\n]*\n/gm, "")
      .replace(/export const meta\s*=\s*\{[\s\S]*?\};?/, "")
      .trim();
    expect(body.length).toBeGreaterThanOrEqual(800);
  });

  it("the TODO review banner lives on the shared LegalLayout (single source)", async () => {
    const layout = await readFile(
      path.join(process.cwd(), "src/app/legal/_components/legal-layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("TODO: legal review");
    expect(layout).toMatch(/role="note"/);
  });

  it("the LegalLayout banner mentions the copy is AI-drafted for counsel review", async () => {
    const layout = await readFile(
      path.join(process.cwd(), "src/app/legal/_components/legal-layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("AI-drafted for counsel review");
  });

  it("checkLegalReady() stays dirty until counsel removes the marker", async () => {
    const { checkLegalReady } = await import("../../../scripts/check-legal-ready");
    const result = await checkLegalReady();
    expect(result.clean).toBe(false);
    expect(result.offenders.length).toBe(LEGAL_FILES.length);
    expect(result.scanned.length).toBe(LEGAL_FILES.length);
  });
});

describe("SUBPROCESSORS", () => {
  it("is a non-empty, frozen array whose rows all carry the four fields the DPA renders", () => {
    expect(Object.isFrozen(SUBPROCESSORS)).toBe(true);
    expect(SUBPROCESSORS.length).toBeGreaterThan(0);
    for (const s of SUBPROCESSORS) {
      expect(s.name).toBeTruthy();
      expect(s.purpose).toBeTruthy();
      expect(s.region).toBeTruthy();
      expect(s.dpaUrl).toMatch(/^https?:\/\//);
    }
  });

  it("covers every vendor the codebase actually talks to today", () => {
    const names = new Set(SUBPROCESSORS.map((s) => s.name));
    for (const expected of [
      "IONOS",
      "Cloudflare",
      "Stripe Payments Europe, Ltd.",
      "Resend",
      "Sentry",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });
});
