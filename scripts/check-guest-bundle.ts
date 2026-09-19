import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Guest bundle budget — fails the build if the JS shipped to a QR-scan
 * visitor grows past the ceiling. Reads the real build manifests (what
 * the `/` guest menu route actually references), gzips each chunk, sums.
 * Run after `pnpm build`:
 *
 *   pnpm check:bundle
 *
 * The budget mirrors `lighthouserc.json`'s
 * `resource-summary:script:size`, so a regression fails here — in
 * seconds, on any machine — before it fails Lighthouse in CI.
 *
 * The point is to catch someone accidentally importing a chart library,
 * the admin surface, or (P7-16) five languages of guest copy into the
 * guest page, not to fight React's runtime.
 */

const BUDGET_GZIP_BYTES = 260_000;
// This build serves ONE restaurant, so the guest menu is the root route —
// there is no `/r/[slug]` any more, and pointing at it made this script fail
// with "run `pnpm build` first" even on a fresh build. The `(public)` route
// group stays in the on-disk path even though it never appears in a URL.
const ROUTE_DIR = join(".next", "server", "app", "(public)", "page");
const ROUTE_MANIFEST = join(ROUTE_DIR, "build-manifest.json");
// Turbopack keeps the route's own client chunks OUT of the build-manifest
// (its `pages` map is empty for App Router routes) and lists them in the
// client-reference manifest instead. Without this half the script measured
// only React's runtime and never saw the page's own components — which is
// exactly where the five-locale catalogues used to hide.
const CLIENT_REF_MANIFEST = join(
  ".next",
  "server",
  "app",
  "(public)",
  "page_client-reference-manifest.js",
);
const ROUTE_KEY = "/(public)/page";

interface RouteManifest {
  polyfillFiles: string[];
  rootMainFiles: string[];
  pages: Record<string, string[]>;
}

interface ClientReferenceManifest {
  clientModules?: Record<string, { chunks?: string[] }>;
  entryJSFiles?: Record<string, string[]>;
}

/**
 * One distinctive string per locale, per catalogue: the `close` label of
 * the checkout catalogue and the allergen heading of the menu one. Both
 * are plain string values (not templates), so minification leaves them
 * intact, and each is unique to its language.
 *
 * P7-16's rule is that a `"use client"` component NEVER imports a
 * catalogue module — server components resolve the locale and pass the
 * strings down. So NONE of these may appear in the chunks the guest page
 * boots with, not even the English ones: a hit means a catalogue (and
 * therefore all five languages) leaked back into the guest bundle.
 *
 * The cart drawer is the one exception and it obeys the rule a different
 * way: `src/lib/i18n/checkout/load.ts` pulls ONE locale on its own
 * lazily-imported chunk, which is not part of the page's boot set.
 */
export const LOCALE_SENTINELS: { catalogue: string; locale: string; text: string }[] = [
  { catalogue: "checkout", locale: "en", text: "Close order panel" },
  { catalogue: "checkout", locale: "de", text: "Bestellfenster schließen" },
  { catalogue: "checkout", locale: "es", text: "Cerrar el panel del pedido" },
  { catalogue: "checkout", locale: "it", text: "Chiudi il pannello dell'ordine" },
  { catalogue: "checkout", locale: "ar", text: "إغلاق لوحة الطلب" },
  { catalogue: "menu", locale: "en", text: "May contain traces of" },
  { catalogue: "menu", locale: "de", text: "Kann Spuren enthalten von" },
  { catalogue: "menu", locale: "es", text: "Puede contener trazas de" },
  { catalogue: "menu", locale: "it", text: "Può contenere tracce di" },
  { catalogue: "menu", locale: "ar", text: "قد يحتوي على آثار من" },
];

export interface LocaleLeak {
  file: string;
  catalogue: string;
  locale: string;
  text: string;
}

/** Pure scan, so a unit test can drive it without a build on disk. */
export function findLocaleLeaks(
  chunks: { file: string; source: string }[],
  sentinels: { catalogue: string; locale: string; text: string }[] = LOCALE_SENTINELS,
): LocaleLeak[] {
  const leaks: LocaleLeak[] = [];
  for (const { file, source } of chunks) {
    for (const s of sentinels) {
      if (source.includes(s.text)) {
        leaks.push({ file, catalogue: s.catalogue, locale: s.locale, text: s.text });
      }
    }
  }
  return leaks;
}

/** Every static file the guest page boots with, relative to `.next/`. */
export function guestChunkFiles(cwd: string = process.cwd()): string[] {
  const manifest = JSON.parse(readFileSync(join(cwd, ROUTE_MANIFEST), "utf8")) as RouteManifest;
  const files = new Set<string>([
    ...manifest.polyfillFiles,
    ...manifest.rootMainFiles,
    ...Object.values(manifest.pages).flat(),
  ]);

  // `page_client-reference-manifest.js` is a side-effecting CommonJS file
  // that pushes onto `globalThis.__RSC_MANIFEST`; there is no exported
  // shape to import, so read it the way the Next server does.
  const require = createRequire(import.meta.url);
  require(join(cwd, CLIENT_REF_MANIFEST));
  const rsc = (globalThis as { __RSC_MANIFEST?: Record<string, ClientReferenceManifest> })
    .__RSC_MANIFEST?.[ROUTE_KEY];
  for (const mod of Object.values(rsc?.clientModules ?? {})) {
    for (const chunk of mod.chunks ?? []) files.add(chunk.replace(/^\/_next\//, ""));
  }
  for (const entry of Object.values(rsc?.entryJSFiles ?? {})) {
    for (const chunk of entry) files.add(chunk.replace(/^\/_next\//, ""));
  }
  return [...files];
}

function main(): void {
  // Turbopack (Next 16) writes a per-route build-manifest under
  // .next/server/app/<route>/page/ and a client-reference manifest beside
  // it. Between them they list every client chunk the route boots with —
  // exactly "what a QR-scan guest downloads".
  let files: string[];
  try {
    files = guestChunkFiles();
  } catch {
    console.error(
      `check-guest-bundle: ${join(process.cwd(), ROUTE_MANIFEST)} not found — run \`pnpm build\` first.`,
    );
    process.exitCode = 1;
    return;
  }
  if (files.length === 0) {
    console.error("check-guest-bundle: manifest listed no client files — format change?");
    process.exitCode = 1;
    return;
  }
  let total = 0;
  const rows: [string, number][] = [];
  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".css")) continue;
    const gz = gzipSync(readFileSync(join(process.cwd(), ".next", file))).length;
    total += gz;
    rows.push([file, gz]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  for (const [file, gz] of rows) {
    console.log(`${String(gz).padStart(8)}  ${file}`);
  }
  const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
  console.log(`\nguest route /: ${kb(total)} gzipped (budget ${kb(BUDGET_GZIP_BYTES)})`);
  if (total > BUDGET_GZIP_BYTES) {
    console.error(
      `check-guest-bundle: OVER BUDGET by ${kb(total - BUDGET_GZIP_BYTES)} — something heavy leaked into the guest page.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("check-guest-bundle: OK");

  // ── Guardrail 2: animation library must never leak into guest chunks.
  const sources = rows
    .filter(([file]) => file.endsWith(".js"))
    .map(([file]) => ({ file, source: readFileSync(join(process.cwd(), ".next", file), "utf8") }));
  for (const { file, source } of sources) {
    if (source.includes("AnimatePresence")) {
      console.error(`check-guest-bundle: motion library leaked into guest chunk ${file}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log("guest motion-leak guard: OK");

  // ── Guardrail 3 (P7-16): only the ACTIVE locale's guest copy ships.
  const leaks = findLocaleLeaks(sources);
  if (leaks.length > 0) {
    console.error(
      "check-guest-bundle: guest-copy catalogue leaked into the guest bundle — a client component is importing `@/lib/i18n/*` instead of taking its strings as props:",
    );
    for (const l of leaks) {
      console.error(`   • ${l.file} contains ${l.catalogue}.${l.locale} ("${l.text}")`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`guest locale-leak guard: OK (${LOCALE_SENTINELS.length} sentinels)`);

  // ── Guardrail 4: placeholder images stay right-sized WebP.
  const PLACEHOLDER_BUDGET = 250 * 1024;
  const placeholders = readdirSync(join(process.cwd(), "public")).filter((f) =>
    /^dish_\d_sq-(320|640)\.webp$/.test(f),
  );
  const placeholderTotal = placeholders.reduce(
    (sum, f) => sum + statSync(join(process.cwd(), "public", f)).size,
    0,
  );
  if (placeholders.length < 10 || placeholderTotal > PLACEHOLDER_BUDGET) {
    console.error(
      `check-guest-bundle: dish placeholders ${placeholders.length} files / ${kb(placeholderTotal)} (budget ${kb(PLACEHOLDER_BUDGET)}, expect 10 WebP files)`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `placeholder images: ${kb(placeholderTotal)} across ${placeholders.length} files — OK`,
  );
}

// Execute only when invoked directly, not on import for tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main();
}
