import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Guest bundle budget — fails the build if the JS shipped to a QR-scan
 * visitor grows past the ceiling. Reads the real app-build-manifest
 * (what the `/` guest menu route actually references), gzips each chunk,
 * sums. Run after `pnpm build`:
 *
 *   pnpm check:bundle
 *
 * The budget is deliberately snug over today's measured ~192 KB: the
 * point is to catch someone accidentally importing a chart library or
 * the admin surface into the guest page, not to fight React's runtime.
 */

const BUDGET_GZIP_BYTES = 220 * 1024;
// This build serves ONE restaurant, so the guest menu is the root route —
// there is no `/r/[slug]` any more, and pointing at it made this script fail
// with "run `pnpm build` first" even on a fresh build. The `(public)` route
// group stays in the on-disk path even though it never appears in a URL.
const ROUTE_MANIFEST = join(".next", "server", "app", "(public)", "page", "build-manifest.json");

interface RouteManifest {
  polyfillFiles: string[];
  rootMainFiles: string[];
  pages: Record<string, string[]>;
}

function main(): void {
  // Turbopack (Next 16) writes a per-route build-manifest under
  // .next/server/app/<route>/page/. It lists every client chunk the
  // route boots with — exactly "what a QR-scan guest downloads".
  const manifestPath = join(process.cwd(), ROUTE_MANIFEST);
  let manifest: RouteManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RouteManifest;
  } catch {
    console.error(`check-guest-bundle: ${manifestPath} not found — run \`pnpm build\` first.`);
    process.exitCode = 1;
    return;
  }
  const files = [
    ...manifest.polyfillFiles,
    ...manifest.rootMainFiles,
    ...Object.values(manifest.pages).flat(),
  ];
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
  for (const [file] of rows) {
    if (!file.endsWith(".js")) continue;
    const src = readFileSync(join(process.cwd(), ".next", file), "utf8");
    if (src.includes("AnimatePresence")) {
      console.error(`check-guest-bundle: motion library leaked into guest chunk ${file}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log("guest motion-leak guard: OK");

  // ── Guardrail 3: placeholder images stay right-sized WebP.
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

main();
